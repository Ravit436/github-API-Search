const mysql     = require('mysql');
const Promise   = require('bluebird');

let dbConfig = {
    "host"    : "sql12.freemysqlhosting.net",
    "user"    : "sql12291256",
    "password": "a3MxU1CqGy",
    "database": "sql12291256",
};


function handleDisconnect() {
    connection = mysql.createConnection(dbConfig); 
                                                    
    connection.connect(function (err) {                 
        if (err) {                                      
            console.log('error when connecting to db:', err);
            setTimeout(handleDisconnect, 2000);         
        }                                               
    });                                                 

    connection.on('error', function (err) {
        console.log('db error', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {  
            handleDisconnect();                         
        } else {                                        
            throw err;                                  
        }
    });
}

handleDisconnect();

let dbConnectionsPool = undefined;
function initializePool(){
    dbConnectionsPool = mysql.createPool(dbConfig);
}

initializePool();


exports.dbHandler = {
    executeQuery : function(queryObj){
        return new Promise((resolve, reject) => {
            queryObj.query = queryObj.query.replace(/\s+/g," ");
            var finalQuery = dbConnectionsPool.query(queryObj.query, queryObj.args, function(err, result) {
                queryObj.sql = finalQuery.sql;
                queryObj.sql = queryObj.sql.replace(/[\n\t]/g,'');

                console.log(queryObj.sql);
                if(err && (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_QUERY_INTERRUPTED')) {
                    setTimeout(function () {
                        exports.dbHandler.executeQuery(queryObj)
                            .then((result) => {
                                console.log(result)
                                return resolve(result);
                            }, (error, result) => {
                                return reject(error, result);
                            })
                    }, 50);
                } else if(err) {
                    return reject(err, result);
                } else {
                    return resolve(result);
                }
            });
        });
    }
};