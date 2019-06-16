const Joi               = require('joi');
const constants         = require('./constants');
const utils             = require('./utils');
const responseMessages  = require('./responseMessages');

exports.isSearchRepositoriesValid = isSearchRepositoriesValid;
exports.isImportRepositoryValid = isImportRepositoryValid;

function isSearchRepositoriesValid(req, res, next){
    let options = req.query;

    let schema = Joi.object().keys({
        q           : Joi.string().alphanum().trim().required(),
        page        : Joi.number().integer().positive().required(),
        per_page    : Joi.number().integer().positive().required(),
        sort        : Joi.string().valid(constants.searchReposSortType).optional(),
        order       : Joi.string().valid('asc', 'desc').optional()
    })
    .options({ allowUnknown: true });

    let result = Joi.validate(options, schema);

    if(result.error){
        console.error(result.error);
        let error = new Error(result.error.details[0].message.replace(/\"/g, ""))
        error.show_error = 1;
        return utils.sendErrorResponse(error, res);
    }
    if(options.page * options.per_page > 1000){
        let error = new Error(responseMessages.MAX_SEARCH_RESULTS);
        error.show_error = 1;
        console.error(error.message);
        return utils.sendErrorResponse(error, res);
    }

    next();
}

function isImportRepositoryValid(req, res, next){
    let options = req.query;

    let schema = Joi.object().keys({
        repo_id : Joi.number().integer().positive().required(),
    })
    .options({ allowUnknown: true });

    let result = Joi.validate(options, schema);

    if(result.error){
        console.error(result.error);
        let error = new Error(result.error.details[0].message.replace(/\"/g, ""))
        error.show_error = 1;
        return utils.sendErrorResponse(error, res);
    }

    next();
}