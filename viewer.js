var glMat4 = require('gl-mat4')
var glMat3 = require('gl-mat3')
var glVec3 = require('gl-vec3')
var expandVertexData = require('expand-vertex-data')
var animationSystem = require('skeletal-animation-system')
var mat4ToDualQuat = require('mat4-to-dual-quat')

// Create a canvas to draw onto and add it into the page
var canvas = document.createElement('canvas')
canvas.width = 600
canvas.height = 600

// Add click controls to the canvas so that you can click and drag to move the camera
var isDragging = false
var xCameraRot = Math.PI / 3
var yCameraRot = 0
var lastX
var lastY
canvas.onmousedown = function (e) {
  isDragging = true
  lastX = e.pageX
  lastY = e.pageY
}
canvas.onmousemove = function (e) {
  if (isDragging) {
    xCameraRot += (e.pageY - lastY) / 60
    yCameraRot -= (e.pageX - lastX) / 60

    xCameraRot = Math.min(xCameraRot, Math.PI / 2.3)
    xCameraRot = Math.max(-0.5, xCameraRot)

    lastX = e.pageX
    lastY = e.pageY
  }
}
canvas.onmouseup = function () {
  isDragging = false
}

// As you drag your finger we move the camera
canvas.addEventListener('touchstart', function (e) {
  lastX = e.touches[0].clientX
  lastY = e.touches[0].clientY
})
canvas.addEventListener('touchmove', function (e) {
  e.preventDefault()
  xCameraRot += (e.touches[0].clientY - lastY) / 50
  yCameraRot -= (e.touches[0].clientX - lastX) / 50

  xCameraRot = Math.min(xCameraRot, Math.PI / 2.5)
  xCameraRot = Math.max(xCameraRot, 0.1)

  lastX = e.touches[0].clientX
  lastY = e.touches[0].clientY
})

// Get a handle for WebGL context
var gl = canvas.getContext('webgl')
gl.clearColor(0.0, 0.0, 0.0, 1.0)
gl.enable(gl.DEPTH_TEST)

var numJoints = 18

// Create a simple vertex shader to render our geometry
var vertexGLSL = `
attribute vec3 aVertexPosition;
attribute vec3 aVertexNormal;
attribute vec2 aVertexUV;

attribute vec4 aJointIndex;
attribute vec4 aJointWeight;

varying vec3 vNormal;

uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;
uniform mat3 uNMatrix;

// TODO: Variable
uniform vec4 boneRotQuaternions[${numJoints}];
uniform vec4 boneTransQuaternions[${numJoints}];

varying vec3 vLightWeighting;
varying vec2 vUV;
varying vec3 vWorldSpacePos;

void main (void) {
  // Blend our dual quaternion
  vec4 weightedRotQuats = boneRotQuaternions[int(aJointIndex.x)] * aJointWeight.x +
    boneRotQuaternions[int(aJointIndex.y)] * aJointWeight.y +
    boneRotQuaternions[int(aJointIndex.z)] * aJointWeight.z +
    boneRotQuaternions[int(aJointIndex.w)] * aJointWeight.w;

  vec4 weightedTransQuats = boneTransQuaternions[int(aJointIndex.x)] * aJointWeight.x +
    boneTransQuaternions[int(aJointIndex.y)] * aJointWeight.y +
    boneTransQuaternions[int(aJointIndex.z)] * aJointWeight.z +
    boneTransQuaternions[int(aJointIndex.w)] * aJointWeight.w;

  // Normalize our dual quaternion (necessary for nlerp)
  float xRot = weightedRotQuats[0];
  float yRot = weightedRotQuats[1];
  float zRot = weightedRotQuats[2];
  float wRot = weightedRotQuats[3];
  float magnitude = sqrt(xRot * xRot + yRot * yRot + zRot * zRot + wRot * wRot);
  weightedRotQuats = weightedRotQuats / magnitude;
  weightedTransQuats = weightedTransQuats / magnitude;

  // Convert out dual quaternion in a 4x4 matrix
  //  equation: https://www.cs.utah.edu/~ladislav/kavan07skinning/kavan07skinning.pdf
  float xR = weightedRotQuats[0];
  float yR = weightedRotQuats[1];
  float zR = weightedRotQuats[2];
  float wR = weightedRotQuats[3];

  float xT = weightedTransQuats[0];
  float yT = weightedTransQuats[1];
  float zT = weightedTransQuats[2];
  float wT = weightedTransQuats[3];

  float t0 = 2.0 * (-wT * xR + xT * wR - yT * zR + zT * yR);
  float t1 = 2.0 * (-wT * yR + xT * zR + yT * wR - zT * xR);
  float t2 = 2.0 * (-wT * zR - xT * yR + yT * xR + zT * wR);

  mat4 convertedMatrix = mat4(
      1.0 - (2.0 * yR * yR) - (2.0 * zR * zR),
      (2.0 * xR * yR) + (2.0 * wR * zR),
      (2.0 * xR * zR) - (2.0 * wR * yR),
      0,
      (2.0 * xR * yR) - (2.0 * wR * zR),
      1.0 - (2.0 * xR * xR) - (2.0 * zR * zR),
      (2.0 * yR * zR) + (2.0 * wR * xR),
      0,
      (2.0 * xR * zR) + (2.0 * wR * yR),
      (2.0 * yR * zR) - (2.0 * wR * xR),
      1.0 - (2.0 * xR * xR) - (2.0 * yR * yR),
      0,
      t0,
      t1,
      t2,
      1
      );

  // Transform our normal using our blended transformation matrix.
  // We do not need to take the inverse transpose here since dual quaternions
  // guarantee that we have a rigid transformation matrix.

  // In other words, we know for a fact that there is no scale or shear,
  // so we do not need to create an inverse transpose matrix to account for scale and shear
  vec3 transformedNormal = (convertedMatrix * vec4(aVertexNormal, 0.0)).xyz;

  // Swap our normal's y and z axis since Blender uses a right handed coordinate system
  float y;
  float z;
  y = transformedNormal.z;
  z = -transformedNormal.y;
  transformedNormal.y = y;
  transformedNormal.z = z;

  // We convert our normal into column major before multiplying it with our normal matrix
  transformedNormal = uNMatrix * transformedNormal;

  // Blender uses a right handed coordinate system. We convert to left handed here
  vec4 leftWorldSpace = convertedMatrix * vec4(aVertexPosition, 1.0);
  y = leftWorldSpace.z;
  z = -leftWorldSpace.y;
  leftWorldSpace.y = y;
  leftWorldSpace.z = z;

  vec4 leftHandedPosition = uPMatrix * uMVMatrix * leftWorldSpace;

  gl_Position = leftHandedPosition;

  vNormal = transformedNormal;
  vUV = aVertexUV;
  // World space is same as model space since model matrix is identity
  vWorldSpacePos = leftWorldSpace.xyz;
}
`

// Create a simple fragment shader with some lighting
var fragmentGLSL = `
precision mediump float;

uniform vec3 uLightPos;
uniform vec3 uCameraPos;

varying vec3 vNormal;
varying vec3 vWorldSpacePos;

void main (void) {
  vec3 ambient = vec3(0.24725, 0.1995, 0.0745);

  vec3 lightColor = vec3(1.0, 1.0, 1.0);

  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(uLightPos - vWorldSpacePos);
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 diffuse = diff * vec3(0.75164, 0.60648, 0.22648);

  float shininess = 0.4;
  vec3 viewDir = normalize(uCameraPos - vWorldSpacePos);
  vec3 reflectDir = reflect(-lightDir, normal);
  float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
  vec3 specular = shininess * spec * vec3(0.628281, 0.555802, 0.366065);

  gl_FragColor = vec4(ambient + diffuse + specular, 1.0);
}
`

// Link our shader program
var vertexShader = gl.createShader(gl.VERTEX_SHADER)
gl.shaderSource(vertexShader, vertexGLSL)
gl.compileShader(vertexShader)
console.log(gl.getShaderInfoLog(vertexShader))

var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)
gl.shaderSource(fragmentShader, fragmentGLSL)
gl.compileShader(fragmentShader)
console.log(gl.getShaderInfoLog(fragmentShader))

var shaderProgram = gl.createProgram()
gl.attachShader(shaderProgram, vertexShader)
gl.attachShader(shaderProgram, fragmentShader)
gl.linkProgram(shaderProgram)
gl.useProgram(shaderProgram)

var vertexPosAttrib = gl.getAttribLocation(shaderProgram, 'aVertexPosition')
var vertexNormalAttrib = gl.getAttribLocation(shaderProgram, 'aVertexNormal')
var vertexUVAttrib = gl.getAttribLocation(shaderProgram, 'aVertexUV')
var jointIndexAttrib = gl.getAttribLocation(shaderProgram, 'aJointIndex')
var jointWeightAttrib = gl.getAttribLocation(shaderProgram, 'aJointWeight')

gl.enableVertexAttribArray(vertexPosAttrib)
gl.enableVertexAttribArray(vertexNormalAttrib)
gl.enableVertexAttribArray(vertexUVAttrib)
gl.enableVertexAttribArray(jointIndexAttrib)
gl.enableVertexAttribArray(jointWeightAttrib)

// Get all of our uniform locations
var ambientColorUni = gl.getUniformLocation(shaderProgram, 'uAmbientColor')
var lightingDirectionUni = gl.getUniformLocation(shaderProgram, 'uLightingDirection')
var directionalColorUni = gl.getUniformLocation(shaderProgram, 'uDirectionalColor')
var mVMatrixUni = gl.getUniformLocation(shaderProgram, 'uMVMatrix')
var pMatrixUni = gl.getUniformLocation(shaderProgram, 'uPMatrix')
var nMatrixUni = gl.getUniformLocation(shaderProgram, 'uNMatrix')
var cameraPosUni = gl.getUniformLocation(shaderProgram, 'uCameraPos')
var lightPosUni = gl.getUniformLocation(shaderProgram, 'uLightPos')

var boneRotQuaternions = {}
var boneTransQuaternions = {}
for (var i = 0; i < numJoints; i++) {
  boneRotQuaternions[i] = gl.getUniformLocation(shaderProgram, `boneRotQuaternions[${i}]`)
  boneTransQuaternions[i] = gl.getUniformLocation(shaderProgram, `boneTransQuaternions[${i}]`)
}

// Push our attribute data to the GPU
var vertexPosBuffer = gl.createBuffer()

var vertexNormalBuffer = gl.createBuffer()

var jointIndexBuffer = gl.createBuffer()

var jointWeightBuffer = gl.createBuffer()

var vertexUVBuffer = gl.createBuffer()

var vertexIndexBuffer = gl.createBuffer()

// Set our lighting uniforms
gl.uniform3fv(ambientColorUni, [0.3, 0.3, 0.3])
var lightingDirection = [1, -1, -1]
glVec3.scale(lightingDirection, lightingDirection, -1)
glVec3.normalize(lightingDirection, lightingDirection)
gl.uniform3fv(lightingDirectionUni, lightingDirection)
gl.uniform3fv(directionalColorUni, [1, 1, 1])

gl.uniformMatrix4fv(pMatrixUni, false, glMat4.perspective([], Math.PI / 3, 1, 0.1, 100))

// Load up our texture data
var texture = gl.createTexture()
var textureImage = new window.Image()
var imageHasLoaded
textureImage.onload = function () {
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureImage)
  imageHasLoaded = true
}
textureImage.src = 'cowboy-texture.png'

// Open up a websocket connection to our hot reload server.
// Whenever our server sends us new vertex data we'll update our GPU buffers with the new data.
// Then, next time we draw, this new vertex data will be used. This is the essence of hot-reloading
// our 3D models
var ws = new window.WebSocket('ws://127.0.0.1:8989')
ws.onmessage = function (message) {
  var messageData = JSON.parse(message.data)
  var vertexData = JSON.parse(messageData.modelData)
  armature = JSON.parse(messageData.actionData)

  colladaJointIndicesToName = Object.keys(vertexData.jointNamePositionIndex)
  .reduce(function (indicesToNames, name, index) {
    indicesToNames[index] = name

    return indicesToNames
  }, {})

  vertexData = expandVertexData(vertexData)

  armature.actions = Object.keys(armature.actions)
  // Iterate over each action so that we can process the keyframe times
  .reduce(function (allActions, actionName) {
    allActions[actionName] = Object.keys(armature.actions[actionName])
    // Iterate over each keyframe time so that we can process the world bone space pose matrices
    .reduce(function (allKeyframes, keyframeTime) {
      allKeyframes[keyframeTime] = armature.actions[actionName][keyframeTime]
      // Iterate over the matrices so that we can multiply them by inverse bind, and transpose
      // (transpose because they came from Blender which uses row major)
      // After fixing up our matrices we turn them into dual quaternions
      .map(function (matrix, index) {
        glMat4.multiply(matrix, armature.inverseBindPoses[index], matrix)
        glMat4.transpose(matrix, matrix)

        matrix = mat4ToDualQuat(matrix)

        return matrix
      })

      return allKeyframes
    }, {})

    return allActions
  }, {})

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexPosBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexData.positions), gl.STATIC_DRAW)
  gl.vertexAttribPointer(vertexPosAttrib, 3, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexNormalBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexData.normals), gl.STATIC_DRAW)
  gl.vertexAttribPointer(vertexNormalAttrib, 3, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ARRAY_BUFFER, jointIndexBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexData.jointInfluences), gl.STATIC_DRAW)
  gl.vertexAttribPointer(jointIndexAttrib, 4, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ARRAY_BUFFER, jointWeightBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexData.jointWeights), gl.STATIC_DRAW)
  gl.vertexAttribPointer(jointWeightAttrib, 4, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexUVBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexData.uvs), gl.STATIC_DRAW)
  gl.vertexAttribPointer(vertexUVAttrib, 2, gl.FLOAT, false, 0, 0)

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vertexIndexBuffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(vertexData.positionIndices), gl.STATIC_DRAW)

  currentAnimation = {
    startTime: currentAnimation.startTime,
    keyframes: armature.actions[currentAction]
  }

  renderActionButtons()

  // Keep track of how many indices we need to draw when we call drawElements
  numIndicesToDraw = vertexData.positionIndices.length
}

var numIndicesToDraw
var armature = {}
var colladaJointIndicesToName
var currentAction = 'Walk_polish'
var clockTime = 0
var lastStartTime = new Date().getTime()

var currentAnimation = {
  startTime: 0
}
var previousAnimation

function draw () {
  var currentTime = new Date().getTime()

  // Move the click forwards in seconds - based on the playback speed
  var timeElapsed = (currentTime - lastStartTime) / 1000
  clockTime += timeElapsed
  lastStartTime = currentTime

  gl.clear(gl.COLOR_BUFFER_BIT, gl.DEPTH_BUFFER_BIT)

  if (imageHasLoaded && numIndicesToDraw) {
    // Calculate all of our joint dual quaternions for our model, based
    // on the current time
    var jointNums = []
    for (var i = 0; i < numJoints; i++) {
      jointNums.push(i)
    }

    var animationData = animationSystem.interpolateJoints({
      currentTime: clockTime,
      jointNums: jointNums,
      currentAnimation: currentAnimation,
      previousAnimation: previousAnimation
    })

    // Loop through our joint dual quaternions for this frame and send them to the GPU
    // We'll use them for vertex skinning
    for (var j = 0; j < numJoints; j++) {
      var jointName = colladaJointIndicesToName[j].replace(/_/g, '.')
      var indexToUse = armature.jointNameIndices[jointName]

      indexToUse = j
      gl.uniform4fv(boneRotQuaternions[j], animationData.joints[indexToUse].slice(0, 4))
      gl.uniform4fv(boneTransQuaternions[j], animationData.joints[indexToUse].slice(4, 8))
    }

    // Calculate our normal matrix to appropriately transform our normals
    var modelMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    var nMatrix = glMat3.fromMat4([], modelMatrix)

    var worldSpaceLightPos = [-2, 5, 2]
    gl.uniform3fv(lightPosUni, worldSpaceLightPos)

    // We create a camera and use it as our view matrix
    var camera = glMat4.create()
    var cameraDistance = 18.5
    // cameraDistance = 2.5
    glMat4.translate(camera, camera, [0, 0, cameraDistance])
    var yAxisCameraRot = glMat4.create()
    var xAxisCameraRot = glMat4.create()
    glMat4.rotateX(xAxisCameraRot, xAxisCameraRot, -xCameraRot)
    glMat4.rotateY(yAxisCameraRot, yAxisCameraRot, yCameraRot)
    glMat4.multiply(camera, xAxisCameraRot, camera)
    glMat4.multiply(camera, yAxisCameraRot, camera)

    // We use the camera position uniform to calculate our specular lighting
    gl.uniform3fv(cameraPosUni, [camera[12], camera[13], camera[14]])

    glMat4.lookAt(camera, [camera[12], camera[13], camera[14]], [0, 0, 0], [0, 1, 0])
    var mVMatrix = glMat4.multiply([], camera, modelMatrix)

    gl.uniformMatrix3fv(nMatrixUni, false, nMatrix)
    gl.uniformMatrix4fv(mVMatrixUni, false, mVMatrix)

    gl.drawElements(gl.TRIANGLES, numIndicesToDraw, gl.UNSIGNED_SHORT, 0)
  }

  window.requestAnimationFrame(draw)
}
draw()

/**
 * Render the buttons that allow you to change actions
 */
var actionButtonsContainer = document.createElement('div')
actionButtonsContainer.className = 'action-buttons-container'

var actionButtonElems
/**
 * Loop through all of the model's actions and create a button that allows
 * you to select that action
 */
function renderActionButtons () {
  actionButtonsContainer.innerHTML = null

  actionButtonElems = Object.keys(armature.actions)
  // Right now blender-actions-to-json is duplicating actions for some reason.
  // Filtering out the duplicates here
  .filter(function (actionName) {
    return actionName.indexOf('001') === -1
  })
  // Convert each action into a button that will select that action
  .map(function (actionName) {
    var actionSelectButton = document.createElement('button')
    actionSelectButton.innerHTML = actionName
    actionSelectButton.className = 'action-button'
    actionSelectButton.setAttribute('action-name', actionName)
    actionSelectButton.onclick = function () {
      previousAnimation = {
        startTime: currentAnimation.startTime,
        keyframes: armature.actions[currentAction]
      }

      currentAction = actionName

      currentAnimation = {
        startTime: clockTime,
        keyframes: armature.actions[currentAction]
      }
      highlightSelectedAction()
    }

    return actionSelectButton
  })

  // Add all of the buttons into their container
  actionButtonElems
  .forEach(function (actionButton) {
    actionButtonsContainer.append(actionButton)
  })

  highlightSelectedAction()
}

/**
 * Loop through all of the buttons and highlight the one that is the current action
 */
function highlightSelectedAction () {
  actionButtonElems
  .forEach(function (actionButton) {
    actionButton.className = 'action-button ' +
      (actionButton.getAttribute('action-name') === currentAction ? 'highlighted-action' : '')
  })
}

document.body.append(actionButtonsContainer)
document.body.append(canvas)

/**
 * Styles
 */
var styles = document.createElement('style')
styles.type = 'text/css'
styles.innerHTML = `
.action-buttons-container {
  margin-bottom: 10px;
  width: 500px;
  display: flex;
  flex-wrap: wrap;
}

.action-button {
  background-color: #008CBA;
  border-radius: 5px;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 21px;
  margin-right: 10px;
  outline: none;
  padding: 5px 10px;
}

.action-button:hover {
  background-color: #399CBD;
}

.highlighted-action {
  background-color: #f44336;
}

.highlighted-action:hover {
  background-color: #F78981;
}

`
document.head.append(styles)
