# hrpc

Simple RPC with Protobuf Services

```
npm install hrpc
```

## Usage

First define an RPC service

```proto
message Echo {
  required string value = 1;
}

service Example {
  rpc Echo (Echo) returns (Echo) {}
}
```

Then compile it using the hrpc compiler

```
npm install -g hrpc
hrpc services.proto --rpc=rpc.js --messages=rpc-messages.js
npm install --save hrpc-runtime # make sure to add this to your package.json
```

That's it!

The above produces two files, `rpc.js` and `rpc-messages.js`.
Now you can run an RPC server and client like so:

``` js
const MyRPC = require('./rpc')

// a server
const server = MyRPC.createServer(function (client) {
  client.example.onRequest({
    async echo ({ value }) {
      return { value: 'echo: ' + value }
    }
  })
})

await server.listen('/tmp/test.sock')

// a client
const client = MyRPC.connect('/tmp/test.sock')

const { value } = await client.example.echo({ value: 'hello world!'})
console.log(value) // 'echo: hello world'
```

The client object in the server and that's returned from connect implements the same API
so you can handle requests in both the server and client, depending on your needs!

To destroy a client do:

```js
client.destroy()
```

And to close a server and all open connections do:

```js
await server.close()
```

If your request handler throws an error it is forward to the client using the following schema

```proto
message RPCError {
  required string message = 1;
  optional string code = 2;
  optional int32 errno = 3;
  optional string details = 4;
}
```

And if your rpc method does not return a value you can use the `Void` type in the definition.

## License

MIT
