const path = require('path')
const fs = require('fs-extra')
const dataPath = "/var/lib/overleaf/data/git/"
const outputPath = "/var/lib/overleaf/data/compiles/"
const simpleGit = require('simple-git')
const EditorController = require('../Editor/EditorController')
const crypto = require('crypto')
const sshpk = require('sshpk')

const gitOptions = {
  baseDir: dataPath,
  privateKey: ""
}

var git = simpleGit(gitOptions)

function getRootId(projectId) {
  let decimalValue = BigInt('0x' + projectId)
  let decrementedValue = decimalValue - BigInt(1)
  let decrementedHexString = decrementedValue.toString(16)
  return decrementedHexString
}

async function createFolder(projectId, ownerId, parentId, name) {
  const doc = await EditorController.promises.addFolder(
    projectId,
    parentId,
    name,
    'editor',
    ownerId
  )
 return doc._id.toString()
}

async function createFile(projectId, ownerId, parentId, name, content) {
  try {
    const doc = await EditorController.promises.addDoc(
      projectId,
      parentId,
      name,
      content,
      'editor',
      ownerId
    )
    return doc._id.toString()
  } catch (err) {
    console.error(err.message)
    return "0"
  }
}

async function resetDatabase(projectId, userId, projectPath) {

  const items = await fs.readdir(projectPath)

  for (const item of items) {
    EditorController.deleteEntityWithPath(projectId, item, 'unknown', userId, () => {})
  }
}

async function buildProject(currentPath, projectId, ownerId, parentId){

  const items = await fs.readdir(currentPath)

  for (const item of items) {
    const itemPath = path.join(currentPath, item)
    const stat = await fs.stat(itemPath)

    if (stat.isDirectory() && item != ".git") {
      const newFolderId = await createFolder(projectId, ownerId, parentId, item)
      await buildProject(itemPath, projectId, ownerId, newFolderId)
    } else if (stat.isFile()) {
      const data = fs.readFileSync(itemPath, 'utf8')
      lines = data.split(/\r?\n/)
      const docId = await createFile(projectId, ownerId, parentId, item, lines)
    }
  }
}

function move(projectId, userId) {
  const fullPath = dataPath + projectId + "-" + userId
  const newGitOptions = {
      baseDir: fullPath,
    }
  //git = simpleGit(newGitOptions)

  git.cwd(fullPath)
  git.addConfig('user.name', 'overleaf')
  git.addConfig('user.email', 'overleaf@overleaf.com')
}

function getStatus(){
  return new Promise((resolve, reject) => {
      git.status((err, statusSummary) => {
          if (err) {
              reject(err);
              return;
          }
          else{
              resolve(statusSummary);
          }
        });
      });
}

async function getStaged() {

    try {
        const status = await git.status()
        const stagedFiles = status.staged

        return stagedFiles
    } catch (error) {
        console.error("Error fetching staged files:", error);
        return []
    }
}

async function getNotStaged() {
    console.log('OK')
    try {
        const status = await git.status()
        const modifiedFiles = status.files.filter(file => file.working_dir !== ' ' && file.index === ' ').map(file => file.path)
        const untrackedFiles = status.files.filter(file => file.working_dir === '?' && file.index === '?').map(file => file.path)
        const notStagedFiles = [...modifiedFiles, ...untrackedFiles]
        console.log(notStagedFiles)
        return notStagedFiles
    } catch (error) {
        console.error("Error fetching not staged files:", error);
        return []
    }
}

async function getModified() {

    try {
        const status = await git.status()
        const modifiedFiles = status.modified

        return modifiedFiles
    } catch (error) {
        console.error("Error fetching modified files:", error);
        return []
    }
}

async function gitClone(projectId, ownerId, link){
  const path = dataPath + projectId + "-" + ownerId

  if (!fs.existsSync(path)) {
    fs.mkdirSync(path)
  }

  const key = await getKey(ownerId, 'private')

  const GIT_SSH_COMMAND = `ssh -o StrictHostKeyChecking=no -i ${key}`
  git = simpleGit().env({'GIT_SSH_COMMAND': GIT_SSH_COMMAND})

  await git.clone(link, path, (error, result) => {
     if (error) {
       console.error('Error when cloning:', error)
     } else {
       console.log("Repository: " + link + " cloned successfully! " + result)
     }
  })
  await buildProject(path, projectId, ownerId, getRootId(projectId))
}

function convertPemToOpenSSH(pemKey) {
  try {

    const key = sshpk.parseKey(pemKey, 'pem')
    const openSSHKey = key.toString('ssh')

    console.log('Key converted to OpenSSH format successfully!')
    return openSSHKey
  } catch (error) {
    console.error('Error converting key:', error)
    return ""
  }
}


async function generateKeyPairAsync() {
  return new Promise((resolve, reject) => {
    crypto.generateKeyPair('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }, (err, publicKey, privateKey) => {
      if (err) {
        reject(err)
      } else {
        resolve({ publicKey, privateKey })
      }
    })
  })
}

async function makeKey(keyPath) {
   try {

    await fs.mkdir(keyPath)


    const { publicKey, privateKey } = await generateKeyPairAsync()

    await Promise.all([
      fs.writeFile(keyPath + "/public", publicKey, 'utf8'),
      fs.writeFile(keyPath + "/private", privateKey, 'utf8')
    ])
    fs.chmod(keyPath + "/private", 0o600, (err) => {
      if (err) {
         console.error(`Error changing permissions : ${err.message}`);
      return;
      }
      console.log('Permissions changed');
      })

    console.log('SSH keys generated successfully!')
  } catch (error) {
    console.error('Error generating SSH key:', error)
  }
}

async function getKey(userId, type) {
  const keyPath = dataPath + "keys/" + userId
  console.log(keyPath)
  if (!fs.existsSync(keyPath + '/private')) {
    await makeKey(keyPath)
  }
  if (type === 'private') {
    const privateKey = "/" + dataPath + "keys/" + userId + "/private"
    console.log(privateKey)
    return privateKey

  } else {
    const publicKeyPEM = await fs.readFile(keyPath + '/public', 'utf8')
    const publicKey = convertPemToOpenSSH(publicKeyPEM)
    return publicKey
  }
}

function deleteFolderContents(folderPath) {
    const files = fs.readdirSync(folderPath)

    files.forEach(file => {
        const filePath = path.join(folderPath, file)

        if (file === '.git') {
            return
        }

        const stats = fs.lstatSync(filePath)

        if (stats.isDirectory()) {
            deleteFolderContents(filePath)
            fs.rmdirSync(filePath)
        } else {
            fs.unlinkSync(filePath)
        }
    })
}

function resetFolder(src) {
    if (!fs.existsSync(src)) {
        return
    }

    const stats = fs.lstatSync(src)

    if (!stats.isDirectory()) {
        return
    }

    deleteFolderContents(src)
    console.log(`${src} folder reset`)
}

async function gitUpdate(projectId, ownerId) {
    console.log("Copying")
    const src = outputPath + projectId + "-" + ownerId
    const dest = dataPath + projectId + "-" + ownerId
    const bannedFiles = ['output.aux', 'output.fdb_latexmk', 'output.fls', 'output.log', 'output.pdf', 'output.stdout', 'output.synctex.gz', '.project-sync-state'];

    resetFolder(dest)

      fs.copy(src, dest, err => {

        if (err) {
          console.error(`Error when copying ${src} to ${dest}:`, err)
          return
        }

        fs.readdir(dest, (err, files) => {
        if (err) {
            console.error(`Erreur when reading folder: ${err}`)
            return
        }

        files.forEach(file => {

            const filePath = path.join(dest, file)

            fs.stat(filePath, (err, stats) => {

                if (err) {
                    console.error(`Error getting stats of file: ${filePath}, ${err}`);
                    return;
                }

                if (bannedFiles.includes(path.basename(filePath))) {
                   fs.remove(filePath, err => {
                        if (err) {
                            console.error(`Couldn't delete file: ${filePath}, ${err}`)
                            return
                        }
                    });
                }
           });
       });
    console.log("Source: " + src)
    console.log("Destination: " + dest)
     })
    })
}

GitController = {

  test(req, res){
    console.log("[TEST COMPLETED]")
    res.sendStatus(200)
  },

  commit(req, res){
    const id = req.body.id
    const projectPath = dataPath + id
    const filePath = req.body.filePath
    console.log("Commit " + filePath + " in " + projectPath)
    res.sendStatus(200)
  },

  pull(req, res) {
    const projectId = req.body.projectId
    const userId = req.body.userId
    const projectPath = dataPath + projectId + "-" + userId

    console.log("Pulling")

    resetDatabase(projectId, userId, projectPath)
    .then(() => getKey(userId, 'private'))
      .then(key => {
        const GIT_SSH_COMMAND = `ssh -o StrictHostKeyChecking=no -i ${key}`;
        git = simpleGit().env({'GIT_SSH_COMMAND': GIT_SSH_COMMAND});
        return move(projectId, userId)
      })
      .then(() => git.pull())
      .then(update => {
        console.log("Repository pulled");
        return buildProject(projectPath, projectId, userId, getRootId(projectId));
      })
      .then(() => res.sendStatus(200))
      .catch(error => {
        console.error("Error:", error);
        res.sendStatus(500);
      });
  },

  add(req, res) {
    const projectId = req.body.projectId
    const userId = req.body.userId
    const filePath = req.body.filePath
    console.log("Adding " + filePath)
    move(projectId, userId)

    git.add(filePath, (error) => {
        if (error) {
          console.error("Could not add the file", error)
          res.sendStatus(500)
        }
        else{
          console.log('File added')
          res.sendStatus(200)
        }
     })
  },

  commit(req, res) {
    const projectId = req.body.projectId
    const userId = req.body.userId
    const message = req.body.message
    console.log("Commit with message: " + message)
    move(projectId, userId)

    git.commit(message, (error) => {
        if (error) {
          console.error("Could not commit", error)
          res.sendStatus(500)
        }
        else{
          console.log('Commit successful')
          res.sendStatus(200)
        }
     })
  },

  push(req, res) {
    const projectId = req.body.projectId
    const userId = req.body.userId
    console.log("Pushing")

    move(projectId, userId)

    getKey(userId, 'private')
      .then(key => {
        const GIT_SSH_COMMAND = `ssh -o StrictHostKeyChecking=no -i ${key}`;
        git = simpleGit().env({'GIT_SSH_COMMAND': GIT_SSH_COMMAND});
        return move(projectId, userId)
      })
      .then(() => git.push())
      .then(() => {
        console.log('Push successful')
        res.sendStatus(200);
      })
      .catch(error => {
        console.error("Error:", error)
        res.sendStatus(500)
      })
  },

  stagedFiles(req, res) {
    const { projectId, userId } = req.query

    move(projectId, userId)

    getStaged()
    .then(stagedFilesList => {
      res.json(stagedFilesList)
    })
    .catch(error => {
      console.error("Error:", error)
      res.json([])
    })
  },

  notStagedFiles(req, res) {
    const { projectId, userId } = req.query

    move(projectId, userId)

    getNotStaged()
    .then(notStagedFilesList => {
      res.json(notStagedFilesList)
    })
    .catch(error => {
      console.error("Error:", error)
      res.json([])
    })
  },

  getKey(req, res) {
    function getUserIdFromUrl(url) {
      const regex = /\/ssh-key\?userId=(?<userId>[^\&]+)/
      const match = url.match(regex)

      if (match) {
        return match.groups.userId
      } else {
        return null
      }
    }
    const userId = getUserIdFromUrl(req.url)
    const privateKey = getKey(userId, 'public')
    privateKey.then((privateKeyValue) => {
      res.send(privateKeyValue)
    });
  }
}

module.exports = {GitController, gitClone, gitUpdate}
