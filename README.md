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