import bpy
import sys

argv = sys.argv
# Get all args after `--`
argv = argv[argv.index('--') + 1:]

daeFilePath = argv[1]

bpy.ops.object.mode_set(mode = 'OBJECT')

bpy.ops.wm.collada_export(
    filepath=daeFilePath,
    selected=True,
    include_armatures=True,
    include_uv_textures=True,
    triangulate=True,
    use_texture_copies=True
    # apply_modifiers=True
)
