# Blender -> WebGL Skinned Hot Reload Experiment | Part 2

An experiment in hot reloading skinned models from Blender to a WebGL Scene

[Read the Blog Post](http://chinedufn.com/blender-skinned-webgl-hot-reload/)

![Cowboy skinned hot reload](hot-reload-example.gif)

To run locally

```sh
git clone https://github.com/chinedufn/blender-webgl-skinned-hot-reload-experiment.git
cd blender-webgl-skinned-hot-reload-experiment.git
npm install
npm start
```

Every time you save `model.blend` in Blender your browser should update with the new model.
Note that it will only start rendering after your first save
(I don't want to take the time to go in and change it to render immediately but PRs are welcome!)
