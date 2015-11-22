# arrow-zeromq
Arrowjs Core plugin to use zmq


## Sample service action :

```
action.index = function (cb) {
        cb(null, "hello");
    }
```


## Sample call a service :

```
 application.services.B.send({
            action: 'demo.index',
            data: {
                username: 'Quoc Cuong',
                password: 'xyz'
            }
        }, function (err,result) {
            if (err) {
                res.send(err);
            } else {
                res.send(result)
            }
        })
```

## Service config :

```
 "use strict";
 
 module.exports = {
     services: { //remote services setting
         demo: {
             protocol: "tcp",      //default tcp
             host: "127.0.0.1",  //default 127.0.0.1
             port: "5555", // must have
             type: "dealer", //default dealer
             subscribe: "key", //default null
             connectionType : 'connect',//default connect
             encode : function () { // default JSON.stringify
     
             },
             decode : function () { // default JSON.parser
     
             },
             monitor_events: { //default null
                 connect: function (fd, ep) {
                     console.log('connect, endpoint:', ep);
                 }
             },
             monitor: { //default null
                 interval: 500,
                 numOfEvents: 0
             },
             //sample send function
             send: function () {
                 let socket = this.socket
             },
             //sample on event function
             onMessage: function () {
                 let socket = this.socket
             }
         }
     },
     service_setting: { // self setting
         enable: true, //default false
         protocol: "tcp", //default tcp
         host: "127.0.0.1", // default 127.0.0.1
         port: "3333", // default server port
         type: "router", //default router
         connect_type: "bind", //default bind
         send: function () {
             let socket = this.socket
         },
         onMessage: function () {
             let socket = this.socket
         }
     }
 };
```