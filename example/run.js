const HRPC = require('./rpc')

HRPC.createServer(function (client) {
  client.onRequest({
    test (req) {
      return { res: req.name }
    },
    boring () {
      console.log('booooring!')
    }
  })
}).listen('/tmp/test.sock').then(function () {
  console.log('listening...')

  const c = HRPC.connect('/tmp/test.sock')

  c.test({ name: 'foo' }).then(res => {
    console.log(res)
  })

  c.boringNoReply()
})
