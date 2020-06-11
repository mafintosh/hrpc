const HRPC = require('./rpc')

HRPC.createServer(function (client) {
  client.onRequest({
    test (req) {
      if (req.name === 'fail') {
        const err = new Error('failing')
        err.errno = -2
        err.code = 'FAIL'
        throw err
      }
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

  c.test({ name: 'fail' }).catch(err => {
    console.log(err)
  })

  c.boringNoReply()
})
