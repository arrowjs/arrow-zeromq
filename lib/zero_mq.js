"use strict";
let path  = require('path');
let fs = require('fs');
let zmq = require('zmq');
let fsEx = require('fs-extra');
let _ = require('lodash');

module.exports = function (options) {
    options = options || {};
    let fileFolder = options.settingFile || "config/services.js";
    return function () {
        let arrowApp = this;
        let allSetting = loadSetting(arrowApp.arrFolder,fileFolder);
        if(allSetting.service_setting) {
            setupService(arrowApp,allSetting.service_setting);
        }

        if(allSetting.services) {
            loadServices(arrowApp,allSetting.services)
        }
        return arrowApp
    }
};

function loadSetting(baseFolder,fileFolder) {
    let setting = {};
    let filePath = path.normalize(baseFolder + fileFolder);
    try {
        fs.accessSync(filePath);
        _.assign(setting, require(filePath));
    } catch (err) {
        if (err.code === 'ENOENT') {
            fsEx.copySync(path.resolve(__dirname, 'services.js'), filePath);
            _.assign(setting, require(filePath));
        } else {
            throw err
        }

    }
    return setting;
}

function setupService(app,serviceConfig) {
    if (serviceConfig && serviceConfig.enable) {
        let protocol = serviceConfig.protocol || 'tcp',
            host = serviceConfig.host || '127.0.0.1',
            port = serviceConfig.port || app.getConfig('port');
        let connectString = `${protocol}://${host}:${port}`;
        let connectionType = serviceConfig.connect_type || "bind";
        let socketType = serviceConfig.type || "router";
        if (serviceConfig.sync && connectionType !== "connect") {
            connectionType += 'Sync';
        }
        app.service = {};
        app.service.socket = zmq.socket(socketType);

        app.service.socket[connectionType](connectString, function (err) {
            if (err)
                app.logger.error(err);
            else {
                app.logger.info('Service started: ' + connectString);
                app.service.socket.on('message', function (envelope, obj) {
                    obj = JSON.parse(obj);
                    let response = "null";
                    let error = "null";
                    if (obj.action && obj.data) {
                        let action = getDataByDotNotation(app.actions,obj.action);
                        if (action) {
                            action(obj.data, function (err,result) {
                                if (err) {
                                    error = JSON.stringify({error: true, message: err.message, content : err});
                                }
                                console.log(result);
                                result = JSON.stringify(result);
                                app.service.socket.send([envelope,error, result]);
                            })
                        } else {
                            error = JSON.stringify({error: true, message: `invalid action`});
                            app.service.socket.send([envelope, error, response]);
                        }

                    } else {
                        error = JSON.stringify({error: true, message: `invalid data`});
                        app.service.socket.send([envelope,error, response]);
                    }
                })
            }
        });
    }
    return app
}

function loadServices(app,serviceConfig) {
    app.services = {};

    if (serviceConfig) {
        Object.keys(serviceConfig).map(function (serviceName) {
            app.services[serviceName] = {};
            let protocol = serviceConfig[serviceName].protocol || 'tcp',
                host = serviceConfig[serviceName].host || '127.0.0.1',
                port = serviceConfig[serviceName].port;
            let connectString = `${protocol}://${host}:${port}`;
            let connectionType = serviceConfig[serviceName].connect_type || "connect";
            if (serviceConfig[serviceName].sync && connectionType !== "connect") {
                connectionType += 'Sync';
            }
            let socketType = serviceConfig.type || "dealer";

            if (port) {
                app.services[serviceName].socket = zmq.socket(socketType);
            }
            app.services[serviceName].socket[connectionType](connectString);
            handleService(app.services[serviceName].socket, serviceConfig[serviceName], app);
            //app.logger.info(`Connecting to ${serviceName}: ${connectString}`);

            app.services[serviceName].send = function (obj, callback) {
                if (typeof(obj) == `object`) {
                    if (obj.action && obj.data ) {
                        var message = JSON.stringify(obj);
                        app.services[serviceName].socket.send(message);
                        app.services[serviceName].socket.once(`message`, function (err,data) {
                            err = JSON.parse(err);
                            if(String(err) !== "null") {
                                callback(err);
                            } else {
                                var result = JSON.parse(data);
                                callback(null,result);
                            }
                        });
                    } else {
                        let error = JSON.stringify({error: true, message: `no data or action`});
                        callback(error)
                    }
                }
            }
        })
    }

    return app;
}

function handleService(service, config, application) {
    if (config.subscribe && _.isString(config.subscribe)) {
        service.subscribe(config.subscribe)
    }
    if (config.monitor && config.monitor.interval && config.monitor.numOfEvents) {
        if (_.isObject(config.monitor_events)) {
            service.monitor(config.monitor.interval, config.monitor.numOfEvents)
            Object.keys(config.monitor_events).map(function (event) {
                if (_.isFunction(config.monitor_events[event])) {
                    service.on(event, monitor_events[event].bind(application))
                }
            })
        }
    }
}

function getDataByDotNotation(obj, key) {
    if (_.isString(key)) {
        if (key.indexOf(".") > 0) {
            let arrayKey = key.split(".");
            let self = obj;
            let result;
            arrayKey.map(function (name) {
                if (self[name]) {
                    result = self[name];
                    self = result;
                } else {
                    result = null
                }
            });
            return result
        } else {
            return obj[key];
        }
    } else {
        return null
    }
}