const HRPC = require('./rpc')

HRPC.createServer(function (client) {
  client.test.onRequest({
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

  c.test.test({ name: 'foo' }).then(res => {
    console.log(res)
  })

  c.test.test({ name: 'fail' }).catch(err => {
    console.log(err)
  })

  c.test.boringNoReply()
})
