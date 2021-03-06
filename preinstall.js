#!/usr/bin/env node

var fs = require('fs')
var os = require('os')
var proc = require('child_process')
var path = require('path')
var ini = require('ini')

var dir = path.join(__dirname, 'hidapi')
var tmp = path.join(__dirname, 'tmp')
var arch = process.env.PREBUILD_ARCH || os.arch()

if (process.argv.indexOf('--arch') > -1) {
  arch = process.argv[process.argv.indexOf('--arch') + 1]
}

var warch = arch === 'x64' ? 'x64' : 'Win32'

if (process.argv.indexOf('--print-arch') > -1) {
  console.log(arch)
  process.exit(0)
}

if (process.argv.indexOf('--print-lib') > -1) {
  switch (os.platform()) {
    case 'darwin':
      console.log('../lib/libhidapi-' + arch + '.dylib')
      break
    case 'openbsd':
    case 'freebsd':
    case 'linux':
      console.log(path.join(__dirname, 'lib/libhidapi-hidraw-' + arch + '.so'))
      break
    case 'win32':
      console.log('../hidapi/Build/Release/' + warch + '/libhidapi.lib')
      break
    default:
      process.exit(1)
  }

  process.exit(0)
}

mkdirSync(path.join(__dirname, 'lib'))

switch (os.platform()) {
  case 'darwin':
    buildDarwin()
    break

  case 'win32':
    buildWindows()
    break

  default:
    buildUnix('hidraw', 'so', function (err) {
      if (err) throw err
    })
    break
}

function findMsBuild () {
  var possiblePathSuffixes = [
    '/Microsoft Visual Studio/2017/BuildTools/MSBuild/15.0/Bin/msbuild.exe',
    '/Microsoft Visual Studio/2017/Enterprise/MSBuild/15.0/Bin/msbuild.exe',
    '/Microsoft Visual Studio/2017/Professional/MSBuild/15.0/Bin/msbuild.exe',
    '/Microsoft Visual Studio/2017/Community/MSBuild/15.0/Bin/msbuild.exe',
    '/MSBuild/14.0/Bin/MSBuild.exe',
    '/MSBuild/12.0/Bin/MSBuild.exe'
  ]

  // First try X86 paths (on 64 bit machine which is most likely) then 32 bit
  var possiblePaths = possiblePathSuffixes.map(p => process.env['PROGRAMFILES(X86)'] + p)
    .concat(possiblePathSuffixes.map(p => process.env['PROGRAMFILES'] + p))

  possiblePaths.push(process.env.WINDIR + '/Microsoft.NET/Framework/v4.0.30319/MSBuild.exe')

  for (var counter = 0; counter < possiblePaths.length; counter++) {
    var possiblePath = path.resolve(possiblePaths[counter])
    try {
      fs.accessSync(possiblePath)
      return possiblePath
    } catch (error) {
      // Binary not found checking next path
    }
  }

  console.error('MSBuild not found')
  console.error('You can run "npm install --global --production windows-build-tools" to fix this.')

  process.exit(1)
}

function buildWindows () {
  var res = path.join(__dirname, 'lib/libhidapi-' + arch + '.dll')
  if (fs.existsSync(res)) return

  var msbuild = findMsBuild()
  var args = ['/p:Configuration=Release;Platform=' + warch, '/nologo']
  spawn(msbuild, args, { cwd: path.join(__dirname, 'msvc'), stdio: 'inherit' }, function (err) {
    if (err) throw err

    var dll = path.join(dir, 'Build/Release/' + warch + '/libhidapi.dll')

    fs.rename(dll, res, function (err) {
      if (err) throw err
    })
  })
}

function buildUnix (driver, ext, cb) {
  var res = path.join(__dirname, `lib/libhidapi-${driver != null ? driver + '-' : ''}` + arch + '.' + ext)
  if (fs.existsSync(res)) return cb(null, res)

  spawn('./bootstrap', [], { cwd: dir, stdio: 'inherit' }, function (err) {
    if (err) throw err
    spawn('./configure', ['--prefix=' + tmp], { cwd: dir, stdio: 'inherit' }, function (err) {
      if (err) throw err
      spawn('make', ['clean'], { cwd: dir, stdio: 'inherit' }, function (err) {
        if (err) throw err
        spawn('make', ['install'], { cwd: dir, stdio: 'inherit' }, function (err) {
          if (err) throw err

          var la = ini.decode(fs.readFileSync(path.join(tmp, `lib/libhidapi${driver != null ? '-' + driver : ''}.la`)).toString())

          var lib = fs.realpathSync(path.join(la.libdir, la.dlname))
          fs.rename(lib, res, function (err) {
            if (err) throw err
            if (cb) cb(null, res)
          })
        })
      })
    })
  })
}

function buildDarwin () {
  buildUnix(null, 'dylib', function (err, res) {
    if (err) throw err
    spawn('install_name_tool', ['-id', res, res], { stdio: 'inherit' }, function (err) {
      if (err) throw err
    })
  })
}

function spawn (cmd, args, opts, cb) {
  var c = proc.spawn(cmd, args, opts)
  c.on('exit', function (code) {
    if (code) return cb(new Error(cmd + ' exited with ' + code))
    cb(null)
  })
}

function mkdirSync (p) {
  try {
    fs.mkdirSync(p)
  } catch (err) {
    // do nothing
  }
}
