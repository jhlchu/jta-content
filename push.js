const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require('crypto');
const request = require("request");
 
const { requireAuth } = require('firebase-tools/lib/requireAuth'); // see https://gist.github.com/puf/e00c34dd82b35c56e91adbc3a9b1c412#gistcomment-3260638
const api = require('firebase-tools/lib/api');
 
const isDryRun = process.argv[4] !== "commit";
 
if (!process.argv[2] || !process.argv[3]) {
    console.error(`
ERROR: Must supply a site name and file to deploy. Usage:
  node deployFile.js <site_name> <file_to_deploy> [commit]`);
  process.exit(1);
}
 
const site = process.argv[2];
const file = process.argv[3];
 
requireAuth({}, ['https://www.googleapis.com/auth/cloud-platform']).then(async () => {
  try {
    // Steps in this script:
    // 1. Determine version of the latest release
    // 2. Get list of files in that version
    // 3. Determine the hash of our local file
    // 4. Create a new version
    // 5. Send list of files from previous version, with our own local file in there too
    // 6. Upload our local file if the Hosting server requests it
    // 7. Finalize our new version
    // 8. Create a release on this new version
 
    // Determine the latest release
    console.log("Determining latest release...")
    var response = await api.request('GET', `/v1beta1/sites/${site}/releases`, { auth: true, origin: api.hostingApiOrigin });
    
    let releases = response.body.releases;
 
    releases.forEach((release) => { console.log(/*release.name, */release.version.status, release.version.createTime, release.version.fileCount, release.version.name); })
    let latestVersion = releases[0].version.name;
    
    // Get the files in the latest version
    console.log("Getting files in latest version...")
    response = await api.request('GET', `/v1beta1/${latestVersion}/files`, { auth: true, origin: api.hostingApiOrigin });
    console.log(response.body);
    var files = {};
    response.body.files.forEach(file => {
      files[file.path] = file.hash;
    })
 
    // prep our own file that we're uploading
    const hasher = crypto.createHash("sha256");
    const gzipper = zlib.createGzip({ level: 9 });
 
    var zipstream = fs.createReadStream(process.cwd()+file).pipe(gzipper);
    zipstream.pipe(hasher);

    files[file] = await new Promise(function(resolve, reject) {
      zipstream.on("end", function() {
        resolve(hasher.read().toString("hex"));
      });
      zipstream.on("error", reject);
    });
    console.log(files[file]);
 
    // Create a new version
    console.log("Creating new version...")
    response = await api.request('POST', `/v1beta1/sites/${site}/versions`, { auth: true, origin: api.hostingApiOrigin });
    console.log(response.body);
    let version = response.body.name;
    
    // Send file info for the new version to the server, to hear what we need to upload
    console.log("Sending file listing for new version...")
    response = await api.request('POST', `/v1beta1/${version}:populateFiles`, {
      auth: true,
      origin: api.hostingApiOrigin,
      data: { files: files }
    })
    console.log(response.body);
 
    let requiredHashes = response.body.uploadRequiredHashes;
    let uploadUrl = response.body.uploadUrl;
 
    if (requiredHashes && requiredHashes.indexOf(files[file]) >= 0) {
      console.log(`Uploading ${file}...`)
      let reqOpts = await api.addRequestHeaders({
        url: uploadUrl +"/"+ files[file],
      })
      await new Promise(function(resolve, reject) {
        fs.createReadStream(process.cwd()+file).pipe(zlib.createGzip({ level: 9 })).pipe(
          request.post(reqOpts, function(err, res) {
            if (err) {
              return reject(err);
            } else if (res.statusCode !== 200) {
              console.error(
                "HTTP ERROR",
                res.statusCode,
                ":",
                res.headers,
                res.body
              );
              return reject(new Error("Unexpected error while uploading file."));
            }
            resolve();
          })
        );
      });
    }
 
    if (!isDryRun) {
      console.log("Finalizing new version...");
      response = await api.request('PATCH', `/v1beta1/${version}?updateMask=status`, {
        origin: api.hostingApiOrigin,
        auth: true,
        data: { status: "FINALIZED" },
      })
      console.log(response.body);
 
      console.log("Releasing new version...");
      response = await api.request('POST', `/v1beta1/sites/${site}/releases?version_name=${version}`, {
          auth: true,
          origin: api.hostingApiOrigin,
          data: { message: "Deployed from test.js" || null },
        }
      );
      console.log(response.body);
    }
    else {
      console.log("Dry run only.")
      // Delete the version we just created, just to be nice
      console.log("Deleting new version...")
      response = await api.request('DELETE', `/v1beta1/${version}`, { auth: true, origin: api.hostingApiOrigin });
      console.log(response.body);
    }
  } catch (error) {
    console.error(error);
  }
});
