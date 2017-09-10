var chokidar = require('chokidar')
var cp = require('child_process')
var cuid = require('cuid')
var fs = require('fs')

// Keep track of connected clients so that we can send the vertex data to every connected browser tab
var connectedClients = {}

// Watch our blend file for changes
chokidar.watch('./*.blend', {})
.on('change', function (blenderFilePath) {
  var modelName = blenderFilePath.split('.blend')[0]
  var colladaPath = modelName + '.dae'
  var jsonPath = modelName + '.json'
  var actionPath = modelName + '-actions.json'

  var exportCommand = `blender model.blend --background --python \`./node_modules/blender-iks-to-fks/bin/ik2fk.js\` --python \`./node_modules/blender-actions-to-json/cmd.js\` --python blender-to-dae.py -- ${actionPath} ${colladaPath}`

  var modelAndActionsReady = false
  var modelData
  var actionData

  // Use the blender CLI to export our .blend model as OBJ
  cp.exec(
    // Make sure that `blender` is in your PATH.
    // On mac you can try adding the following to your ~/.bash_profile:
    //  # Blender CLI
    //  export PATH="$PATH:/Applications/blender.app/Contents/MacOS"
    exportCommand,
    function (err, stdout, stderr) {
      if (err) {
        return console.error(`exec error: ${err}`)
      }

      // Convert DAE file into JSON using wavefront-obj-parser
      cp.exec(
        `cat ${colladaPath} | node ./node_modules/collada-dae-parser/bin/dae2json.js > ${jsonPath}`,
        function (err, stdout, stderr) {
          if (err) { throw err }

          // Ready and prepare our model data
          fs.readFile(jsonPath, function (err, jsonModelFile) {
            if (err) { throw err }

            modelData = jsonModelFile.toString()

            if (modelAndActionsReady) {
              messageConnectedClients(modelData, actionData)
            }

            modelAndActionsReady = true
          })
        }
      )

      // Read and prepare our actions keyframe data
      fs.readFile(actionPath, function (err, jsonActionFile) {
        if (err) { throw err }

        // TODO: Process json actions here
        actionData = jsonActionFile.toString()

        if (modelAndActionsReady) {
          messageConnectedClients(modelData, actionData)
        }

        modelAndActionsReady = true
      })
    }
  )

  /**
   * Send data down to all connected clients
   */
  function messageConnectedClients (modelData, actionData) {
    for (var clientId in connectedClients) {
      if (connectedClients[clientId].readyState === WebSocket.OPEN) {
        connectedClients[clientId].send(
          JSON.stringify({
            modelData: modelData,
            actionData: actionData
          })
        )
      }
    }
  }
})

var WebSocket = require('ws')
var wsServer = new WebSocket.Server({port: 8989})

// Start WebSocket server and keep track of currently connected clients
wsServer.on('connection', function (ws) {
  ws.clientId = cuid()
  connectedClients[ws.clientId] = ws

  ws.on('close', function () {
    delete connectedClients[ws.clientId]
  })
})
