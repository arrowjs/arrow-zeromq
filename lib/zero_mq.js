"use strict";
let path = require('path');
let fs = require('fs');
let zmq = require('zmq');
let fsEx = require('fs-extra');
let _ = require('lodash');

module.exports = function (options) {
    options = options || {};
    let fileFolder = options.settingFile || "config/services.js";
    return function () {
        let arrowApp = this;
        let allSetting = loadSetting(arrowApp.arrFolder, fileFolder);
        if (allSetting.service_setting) {
            setupService(arrowApp, allSetting.service_setting);
        }

        if (allSetting.services) {
            loadServices(arrowApp, allSetting.services)
        }
        return arrowApp
    }
};

function loadSetting(baseFolder, fileFolder) {
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

function setupService(app, serviceConfig) {
    let encode = serviceConfig.encode || JSON.stringify;
    let decode = serviceConfig.decode || JSON.parse;

    let defaultOnMessage = function (envelope, obj) {
        let self = this;
        obj = decode(obj);
        serviceConfig.logging && app.logger.info("Received: ", obj);
        let response = "null";
        let error = "null";
        if (obj.action) {
            let action = getDataByDotNotation(app.actions, obj.action);
            if (action) {
                if (obj.data) {
                    action(obj.data, function (err, result) {
                        if (err) {
                            error = encode({error: true, message: err.message, content: err});
                        }
                        serviceConfig.logging && app.logger.info("Send: ", "\n Error:", error,"\n Result:", result);
                        result = encode(result);
                        self.socket.send([envelope, error, result]);
                    })
                } else {
                    action(function (err, result) {
                        if (err) {
                            error = encode({error: true, message: err.message, content: err});
                        }

                        result = encode(result);
                        serviceConfig.logging && app.logger.info("Send: ", "\n Error:", error,"\n Result:", result);
                        self.socket.send([envelope, error, result]);
                    })
                }
            } else {
                error = encode({error: true, message: `invalid action`});
                serviceConfig.logging && app.logger.info("Send: ", "\n Error:", error);
                self.socket.send([envelope, error, response]);
            }

        } else {
            error = encode({error: true, message: `invalid data`});
            serviceConfig.logging && app.logger.info("Send: ", "\n Error:", error);
            self.socket.send([envelope, error, response]);
        }
    }

    let onMessage = serviceConfig.onMessage || defaultOnMessage;

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

                app.service.socket.on('message', onMessage.bind(app.service));
                handleService(app.service.socket, serviceConfig, app);
                Object.keys(serviceConfig).forEach((function (key) {
                    if(_.isFunction(serviceConfig[key])){
                        if(key.match(/^on[A-Z][a-z]*/)){
                            let eventName = key.slice(2,key.length).toLowerCase();
                            if( eventName !== 'message') {
                                app.service.socket.on(eventName,serviceConfig[key].bind(app.service))
                            }
                        } else {
                            app.service[key] = serviceConfig[key].bind(app.service)
                        }
                    }
                }))
            }
        });

    }
    return app
}

function loadServices(app, serviceConfig) {
    app.services = {};

    if (serviceConfig) {
        Object.keys(serviceConfig).map(function (serviceName) {
            app.services[serviceName] = {};

            let protocol = serviceConfig[serviceName].protocol || 'tcp',
                host = serviceConfig[serviceName].host || '127.0.0.1',
                port = serviceConfig[serviceName].port,
                encode = serviceConfig[serviceName].encode || JSON.stringify,
                decode = serviceConfig[serviceName].decode || JSON.parse;

            let defaultSend = function (obj, callback) {
                if (typeof(obj) == `object`) {
                    var message = encode(obj);
                    this.socket.send(message);
                    this.socket.once(`message`, function (err, data) {
                        err = decode(err);
                        if (String(err) !== "null") {
                            serviceConfig[serviceName].logging && app.logger.error("Send: ", "\n Error:", err,"\n Result:", null);
                            callback(err);
                        } else {
                            var result = decode(data);
                            serviceConfig[serviceName].logging && app.logger.info("Send: ", "\n Error:", null,"\n Result:", result);
                            callback(null, result);
                        }
                    });
                } else {
                    let error = {error: true, message: `No action`};
                    serviceConfig[serviceName].logging && app.logger.info("Send: ", "\n Error:", error,"\n Result:", null);
                    callback(error)
                }
            };
            let send =  serviceConfig[serviceName].send || defaultSend;

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

            app.services[serviceName].send = function (obj,callback) {
                callback({error: true, message: "Cant connect to service: "+ serviceName})
            }

            if(serviceConfig[serviceName].monitor && serviceConfig[serviceName].monitor_events && serviceConfig[serviceName].monitor_events.connect) {
                handleService(app.services[serviceName].socket, serviceConfig[serviceName], app);
            } else {
                handleService(app.services[serviceName].socket, serviceConfig[serviceName], app);
                let interval = serviceConfig[serviceName].monitor ? serviceConfig[serviceName].monitor.interval || 500 : 500;
                let numOfEvent = serviceConfig[serviceName].monitor ? serviceConfig[serviceName].monitor.numOfEvents || 0 : 0;

                app.services[serviceName].socket.monitor(interval, numOfEvent);
                app.services[serviceName].socket.on("connect" ,function () {
                    app.services[serviceName].send = send.bind(app.services[serviceName]);

                    Object.keys(serviceConfig[serviceName]).forEach((function (key) {
                        if(_.isFunction(serviceConfig[serviceName][key])){
                            if(key.match(/^on[A-Z][a-z]*/)){
                                let eventName = key.slice(2,key.length).toLowerCase();
                                app.services[serviceName].socket.on(eventName,serviceConfig[serviceName][key].bind(app.services[serviceName]))
                            } else {
                                if (key !== "send") {
                                    app.services[serviceName][key] = serviceConfig[serviceName][key].bind(app.services[serviceName])
                                }
                            }
                        }
                    }))
                })
            }
        })
    }

    return app
}

function handleService(service, config, application) {
    if (config.subscribe && _.isString(config.subscribe)) {
        service.subscribe(config.subscribe)
    }

    if (config.monitor) {
        let interval = config.monitor.interval || 500;
        let numOfEvent = config.monitor.numOfEvents || 0;

        if (!_.isEmpty(config.monitor_events)) {
            service.monitor(interval, numOfEvent)
            Object.keys(config.monitor_events).map(function (event) {
                if (_.isFunction(config.monitor_events[event])) {
                    service.on(event, config.monitor_events[event].bind(application))
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