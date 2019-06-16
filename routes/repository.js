const Promise           = require('bluebird');
const utils             = require('./utils');
const dbHandler         = require('./dbHandler').dbHandler;
const responseMessages  = require('./responseMessages');

exports.search = search;
exports.importPackage = importPackage;
exports.fetchTopRepositoryPackages = fetchTopRepositoryPackages;

function search(req, res){
    let options = req.query;

    Promise.coroutine(function*(){
        let repositoriesInfo = yield fetchRepositoriesList(options);
        let reposList = yield filterRepositoriesData(repositoriesInfo);
        return {
            repos_list: reposList,
            total_count: repositoriesInfo.total_count
        }
    })()
    .then(result => {
        let response =  {
            status: true,
            message: "Success",
            repos_list: result.repos_list,
            total_count: result.total_count
        };
        utils.sendZippedResponse(response, res);
    })
    .catch(error => {
        console.error(error.stack);
        utils.sendErrorResponse(error, res);
    })
}

async function fetchRepositoriesList(options){
    options.q = options.q + '+language:javascript';

    let url = config.get("github.baseUrl") + config.get("github.endPoints.searchRepositories");
    let response = await utils.sendGetRequestToServer(url, options);
    if(response.incomplete_results == false){
        return response;
    }
    else {
        console.error(response);
        let error = new Error(responseMessages.SOMETHING_WENT_WRONG);
        error.show_error = 1;
        throw error;
    }
}

async function filterRepositoriesData(repositoriesInfo){
    let reposList = [];
    let repoIds = [];
    for(let repo of repositoriesInfo.items){
        let repoInfo = {
            repo_id: repo.id,
            repo_name: repo.name,
            owner: repo.owner.login,
            forks: repo.forks,
            stars: repo.watchers_count
        }
        reposList.push(repoInfo);
        repoIds.push(repo.id);
    }
    let reposExists = [];
    if(repoIds.length){
        reposExists = await fetchImportedRepos(repoIds);
    }
    for(let repo of reposList){
        let repoExists = reposExists.find(repository => repository.repo_id == repo.repo_id);
        if(repoExists){
            repo.is_imported = 1;
        }
    }
    return reposList;
}

function fetchImportedRepos(repoIds){
    let sqlQuery = `SELECT repo_id
                    FROM tb_repos
                    WHERE repo_id IN (?)`

    let queryObj = {
        query: sqlQuery,
        args: [repoIds]
    }

    return dbHandler.executeQuery(queryObj)
}

function importPackage(req, res){
    let options = req.query;

    Promise.coroutine(function*(){
        yield checkIfGithubRepositoryExists(options);
        let packageUrl = yield fetchRepositoryPackage(options);
        let packageData = yield downloadPackageJson(packageUrl);
        let packagesList = filterPackageData(packageData);
        yield updateOrInsertRepositoryDetails(options, packagesList);
        return packagesList;
    })()
    .then(packages => {
        let response =  {
            status: true,
            message: "Success",
            packages_list: packages
        };
        utils.sendZippedResponse(response, res);
    })
    .catch(error => {
        console.error(error.stack);
        utils.sendErrorResponse(error, res);
    })
}

async function checkIfGithubRepositoryExists(options){

    let url = config.get("github.baseUrl") + config.get("github.endPoints.repositories");
    url = url.replace("{{{repo_id}}}", options.repo_id);
    let response = await utils.sendGetRequestToServer(url, options);
    if(response.id == options.repo_id){
        options.owner = response.owner.login;
        options.repo = response.name;
    }
    else {
        console.error(response);
        let error = new Error(responseMessages.NO_REPOSITORY_EXISTS);
        error.show_error = 1;
        throw error;
    }
}

async function fetchRepositoryPackage(options){

    let url = config.get("github.baseUrl") + config.get("github.endPoints.packageRepository");
    url = url.replace("{{{owner}}}", options.owner).replace("{{{repo}}}", options.repo);

    let response = await utils.sendGetRequestToServer(url);
    if(response.type == 'file' && response.path == "package.json"){
        return response.download_url;
    }
    else{
        let error = new Error(responseMessages.NO_PACKAGE_FOR_PROJECT);
        error.show_error = 1;
        throw error;
    }
}

async function downloadPackageJson(packageUrl){
    let packageData = await utils.sendGetRequestToServer(packageUrl);
    if(packageData && typeof packageData == 'object' && !Array.isArray(packageData)){
        return packageData;
    }
    else{
        let error = new Error(responseMessages.PACKAGE_INVALID_FORMAT);
        error.show_error = 1;
        throw error;
    }
}

function filterPackageData(packageData){
    let packagesList = [];
    let dependencies = packageData.dependencies;
    let devDependencies = packageData.devDependencies;
    if(typeof dependencies == 'object' && !Array.isArray(dependencies)){
        packagesList = Object.keys(dependencies);
    }
    if(typeof devDependencies == 'object' && !Array.isArray(devDependencies)){
        packagesList = [...Object.keys(devDependencies), ...packagesList];
    }
    packagesList = [...new Set(packagesList)];

    if(!packagesList.length){
        let error = new Error(responseMessages.NO_DEPENDENCY_IN_PACKAGE);
        error.show_error = 1;
        throw error;
    }
    return packagesList;
}

async function updateOrInsertRepositoryDetails(options, repoPackagesList){
    let [repoInfo] = await checkIfRepositoryExists(options);
    if(!repoInfo){
        repoInfo = {};
        await insertNewRepository(repoInfo, options);
    }

    let packagesList = await fetchExistingPackages(repoInfo, repoPackagesList);
    let newPackages = [];
    for(let package of repoPackagesList){
        let existingPackage = packagesList.find(pkg => pkg.package_name == package);
        if(!existingPackage){
            newPackages.push(package);
        }
    }
    await Promise.map(newPackages, package => {
        return insertNewPackage(packagesList, package);
    })

    let existingRepoPackage = [0], newRepoPackage = [], activateRepoPackage = [];
    for(let package of packagesList){
        if(package.repo_package_id){
            existingRepoPackage.push(package.package_id);
            if(package.repo_package_inactive_id){
                activateRepoPackage.push(package.package_id);
            }
        }
        else{
            newRepoPackage.push(package.package_id);
        }
    }

    await disableOldRepoPackages(repoInfo, existingRepoPackage);
    if(activateRepoPackage.length){
        await activateDisabledRepoPackages(repoInfo, activateRepoPackage);
    }
    if(newRepoPackage.length){
        await addNewRepoPackages(repoInfo, newRepoPackage);
    }
}

function checkIfRepositoryExists(options){
    let sqlQuery = `SELECT id 
                    FROM tb_repos
                    WHERE owner = ? AND repo_name = ? `

    let queryObj = {
        query: sqlQuery,
        args: [options.owner, options.repo]
    }
    return dbHandler.executeQuery(queryObj);
}

function insertNewRepository(repoInfo, options){
    let insertParams = {
        repo_id: options.repo_id,
        owner: options.owner,
        repo_name: options.repo,
    }
    let sqlQuery = `INSERT INTO tb_repos SET ? `

    let queryObj = {
        query: sqlQuery,
        args: [insertParams]
    }
    return dbHandler.executeQuery(queryObj)
    .then(result => {
        repoInfo.id = result.insertId;
    })
}

function fetchExistingPackages(repoInfo, repoPackagesList){
    let sqlQuery = `SELECT p.package_id, p.package_name, 
                    (CASE WHEN rp.is_active = 0 THEN 1 ELSE 0 END) AS repo_package_inactive_id,
                    rp.id AS repo_package_id
                    FROM tb_packages AS p
                    LEFT JOIN tb_repo_packages AS rp ON p.package_id = rp.package_id AND rp.repo_id = ?
                    WHERE p.package_name IN (?) `

    let queryObj = {
        query: sqlQuery,
        args: [repoInfo.id, repoPackagesList]
    }
    return dbHandler.executeQuery(queryObj);
}

function insertNewPackage(packagesList, package){
    let insertParams = {
        package_name: package,
    }
    let sqlQuery = `INSERT INTO tb_packages SET ? `

    let queryObj = {
        query: sqlQuery,
        args: [insertParams]
    }

    return dbHandler.executeQuery(queryObj)
    .then(result => {
        packagesList.push({
            package_id: result.insertId,
            package_name: package
        })
    })
}

function disableOldRepoPackages(repoInfo, repoPackages){
    let sqlQuery = `UPDATE tb_repo_packages 
                    SET is_active = 0
                    WHERE repo_id = ? AND package_id NOT IN (?) `

    let queryObj = {
        query: sqlQuery,
        args: [repoInfo.id, repoPackages]
    }

    return dbHandler.executeQuery(queryObj)
}

function activateDisabledRepoPackages(repoInfo, repoPackages){
    let sqlQuery = `UPDATE tb_repo_packages 
                    SET is_active = 1 
                    WHERE repo_id = ? AND package_id IN (?) `

    let queryObj = {
        query: sqlQuery,
        args: [repoInfo.id, repoPackages]
    }

    return dbHandler.executeQuery(queryObj)
}

function addNewRepoPackages(repoInfo, repoPackage){
    let insertParams = [];
    for(let package of repoPackage){
        let paramInfo = [
            repoInfo.id,
            package
        ]
        insertParams.push(paramInfo);
    }

    let sqlQuery = `INSERT INTO tb_repo_packages (repo_id, package_id) VALUES ? `

    let queryObj = {
        query: sqlQuery,
        args: [insertParams]
    }

    return dbHandler.executeQuery(queryObj)
}

function fetchTopRepositoryPackages(req, res){
    let options = req.query;

    Promise.coroutine(function*(){
        return fetchTopRepositoryPackagesInternal();
    })()
    .then(packages => {
        let response =  {
            status: true,
            message: "Success",
            packages_list: packages
        };
        utils.sendZippedResponse(response, res);
    })
    .catch(error => {
        console.error(error.stack);
        utils.sendErrorResponse(error, res);
    })
}

function fetchTopRepositoryPackagesInternal(){
    let sqlQuery = `SELECT p.package_id, p.package_name, COUNT(*) AS package_used 
                    FROM tb_packages AS p
                    JOIN tb_repo_packages AS rp ON rp.package_id = p.package_id 
                    WHERE rp.is_active = 1 
                    GROUP BY p.package_id
                    ORDER BY package_used DESC
                    LIMIT 10 `

    let queryObj = {
        query: sqlQuery,
        args: []
    }

    return dbHandler.executeQuery(queryObj)
}