
const router           = require('express').Router;

const checkParams       = require('./routes/checkParams');
const repository        = require('./routes/repository');

router.get('/import', checkParams.isImportRepositoryValid, repository.importPackage);
router.get('/packages/top', repository.fetchTopRepositoryPackages);

