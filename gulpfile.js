var gulp = require('gulp');
var debug = require('gulp-debug');
var ts = require("gulp-typescript");
var path = require('path');
var shell = require('shelljs');
var minimist = require('minimist');
var semver = require('semver');
var fs = require('fs');
var del = require('del');
var merge = require('merge-stream');
var cp = require('child_process');
var log = require('fancy-log');
var PluginError = require('plugin-error');

var _buildRoot = path.join(__dirname, '_build');
var _packagesRoot = path.join(__dirname, '_packages');

function errorHandler(err) {
    process.exit(1);
}

gulp.task('default', ['build']);

gulp.task('build', ['clean', 'compile'], function () {
    var extension = gulp.src(['README.md', 'LICENSE', 'images/**/*', 'vss-extension.json'], { base: '.' })
        .pipe(debug({ title: 'extension:' }))
        .pipe(gulp.dest(_buildRoot));
    var task = gulp.src(['task/**/*', '!task/**/*.ts'], { base: '.' })
        .pipe(debug({ title: 'task:' }))
        .pipe(gulp.dest(_buildRoot));

    getExternalModules();

    return merge(extension, task);
});

gulp.task('clean', function () {
    return del([_buildRoot]);
});

gulp.task('compile', ['clean'], function () {
    var taskPath = path.join(__dirname, 'task', '*.ts');
    var tsConfigPath = path.join(__dirname, 'tsconfig.json');

    return gulp.src([taskPath], { base: './task' })
        .pipe(ts.createProject(tsConfigPath)())
        .on('error', errorHandler)
        .pipe(gulp.dest(path.join(_buildRoot, 'task')));
});

gulp.task('package', ['build'], function () {
    var version = getVersion();

    updateExtensionManifest(version);
    updateTaskManifest(version);

    shell.exec('tfx extension create --root "' + _buildRoot + '" --output-path "' + _packagesRoot + '"')
});

gulp.task('upload', ['build'], function () {
    var version = getVersion();

    updateExtensionManifest(version, true);
    updateTaskManifest(version);

    shell.exec('tfx build tasks upload --task-path "' + path.join(_buildRoot, 'task'))
});

getVersion = function () {
    var branch = process.env.APPVEYOR_REPO_BRANCH;
    var tag = process.env.APPVEYOR_REPO_TAG;
    var buildnumber = process.env.APPVEYOR_BUILD_NUMBER;

    console.log("Version for build: ",  process.env.APPVEYOR_BUILD_VERSION);

    var versionFilePath = path.join(__dirname, 'version.json')
    var version = JSON.parse(fs.readFileSync(versionFilePath));

    console.log("Tag: ", tag);
    console.log("Branch: ", branch);
    console.log("Buildnumber: ", buildnumber);
    console.log("Version: ", version);

    if (!tag) {
        if (branch.startsWith("master")) {
            version.prerelease = "rc";
        }
        else if (branch.startsWith("dev")) {
            version.prerelease = "beta";
        }
        else {
            version.prerelease = "alpha";
        }
        version.buildnumber = buildnumber;
    }
    process.env.APPVEYOR_BUILD_VERSION = getVersionAsText(version);
    console.log("Version for build new: ",  process.env.APPVEYOR_BUILD_VERSION);
    return version;
}

getVersionAsText = function (version) {
    if (version.prerelease) {
        return version.major + '.' + version.minor + '.' + version.patch + '-' + version.prerelease + "." + version.buildnumber;
    }
    else {
        return version.major + '.' + version.minor + '.' + version.patch
    }
}

getExternalModules = function () {
    // copy package.json without dev dependencies
    var libPath = path.join(_buildRoot, 'task');

    var pkg = require('./package.json');
    delete pkg.devDependencies;

    fs.writeFileSync(path.join(libPath, 'package.json'), JSON.stringify(pkg, null, 4));

    // install modules
    var npmPath = shell.which('npm');

    shell.pushd(libPath);
    {
        var cmdline = '"' + npmPath + '" install';
        var res = cp.execSync(cmdline);
        log(res.toString());

        shell.popd();
    }

    fs.unlinkSync(path.join(libPath, 'package.json'));
}

updateExtensionManifest = function (version) {
    var manifestPath = path.join(_buildRoot, 'vss-extension.json')
    var manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.version = version.major + "." + version.minor + "." + version.patch;

    if (version.prerelease) {
        var versionAsText = getVersionAsText(version);
        manifest.version = version.major + "." + version.minor + "." + version.patch + "." + version.buildnumber;
        manifest.id = manifest.id + '-' + (versionAsText.includes("alpha") ? "alpha" : "beta");
        manifest.name = manifest.name + ' (' + versionAsText + ')';
        manifest.public = false;
        manifest.galleryFlags.push("Preview");
    }
    else {
        manifest.public = true;
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4));
}

updateTaskManifest = function (version) {
    var manifestPath = path.join(_buildRoot, 'task', 'task.json')
    var manifest = JSON.parse(fs.readFileSync(manifestPath));
    var versionAsText = getVersionAsText(version);

    manifest.version.Major = version.Major;
    manifest.version.Minor = version.Minor;
    manifest.version.Patch = version.Patch;
    manifest.helpMarkDown = 'v' + versionAsText + ' - ' + manifest.helpMarkDown;

    if (version.prerelease) {
        manifest.version.Prerelease = version.Patch;
        manifest.friendlyName = manifest.friendlyName + ' (' + versionAsText + ')';
        manifest.id = '4df4abb0-38d5-11e8-9466-7fef5455a13d';
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4));
}