
var request 					= require('request');
var zlib						= require('zlib');

exports.sendRequestToServer = sendRequestToServer;
exports.sendGetRequestToServer = sendGetRequestToServer;
exports.sendErrorResponse = sendErrorResponse;
exports.sendZippedResponse = sendZippedResponse;

/**
 * A generic function to make a call to a server
 * @param  {String}   url         URL of the server
 * @param  {object}   body        contains params as required by server
 * @param  {object}   addnParams  contains additional options as required by server
 */
function sendRequestToServer(url, body, addnParams) {
	return new Promise((resolve, reject) => {

		let options = {
			url: url,
			method: 'POST',
			body: body,
			json: true,
			rejectUnauthorized: false,
			gzip : true,
			headers: {
				'Content-Type': 'application/json; charset=utf-8'
			}
		};

		if(addnParams){
			Object.assign(options, addnParams);
		}

		request(options, function (error, response, body) {
			if (error) {
				console.error(error.stack);
				return reject(error);
			}

			if (response == undefined) {
				return reject(new Error('No response from server'));
			}

			if (response.statusCode != '200') {
				return reject(new Error('Couldn\'t request to server '));
			}

			resolve(body);
		});
	})
}

/**
 * A generic function to make a call to a server
 * @param  {String}   url         URL of the server
 * @param  {object}   body        contains params as required by server
 * @param  {object}   addnParams  contains additional options as required by server
 */
function sendGetRequestToServer(url, params, addnOptions){
	return new Promise((resolve, reject) => {

		var options = {
			url: url,
			method: "GET",
			qs: params,
			json: true,
			rejectUnauthorized : false,
			headers: {
				'Content-Type': 'application/json; charset=utf-8',
				'user-agent': 'node.js'
			}
		};

		Object.assign(options, addnOptions)

		request(options, function(error, response, body){
			if(error){
				return reject(new Error('Failure from url : ' +  url));
			}

			return resolve(body);
		});
	})
}


/**
 * Sends a response in case of an error
 * @param  {object} error       {status, message}
 * @param  {stream} res         express res stream
 */
function sendErrorResponse(error, res) {
	let response =  {
		status : false,
		message : "Failed",
	};
	
	if(error.show_error){
		response.message = error.message;
	}

	res.send(response);
}

/**
 * Compresses a given response object and sends it.
 * @param  {object} response    Contains the final result of any API
 * @param  {stream} res         express res stream
 */
function sendZippedResponse(response, res) {
    zlib.gzip(JSON.stringify(response), function(error, zippedData) {
        if(error){
            console.error(error.stack);
            return res.send(response);
        }
        res.set({'Content-Encoding': 'gzip'});
        return res.send(zippedData);
    });
}