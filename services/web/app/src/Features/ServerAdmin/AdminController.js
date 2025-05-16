const logger = require('@overleaf/logger')
const http = require('http')
const https = require('https')
const Settings = require('@overleaf/settings')
const TpdsUpdateSender = require('../ThirdPartyDataStore/TpdsUpdateSender')
const TpdsProjectFlusher = require('../ThirdPartyDataStore/TpdsProjectFlusher')
const EditorRealTimeController = require('../Editor/EditorRealTimeController')
const SystemMessageManager = require('../SystemMessages/SystemMessageManager')
const { readdir, stat } = require('fs/promises');
const { join } = require('path');

const dirSize = async dir => {
  const files = await readdir( dir, { withFileTypes: true } );

  const paths = files.map( async file => {
    const path = join( dir, file.name );

    if ( file.isDirectory() ) return await dirSize( path );

    if ( file.isFile() ) {
      const { size } = await stat( path );
      
      return size;
    }

    return 0;
  } );

  return ( await Promise.all( paths ) ).flat( Infinity ).reduce( ( i, size ) => i + size, 0 );
}

const AdminController = {
  _sendDisconnectAllUsersMessage: delay => {
    return EditorRealTimeController.emitToAll(
      'forceDisconnect',
      'Sorry, we are performing a quick update to the editor and need to close it down. Please refresh the page to continue.',
      delay
    )
  },
  index: async (req, res, next) => {
    let url
    const openSockets = {}
    for (url in http.globalAgent.sockets) {
      openSockets[`http://${url}`] = http.globalAgent.sockets[url].map(
        socket => socket._httpMessage.path
      )
    }

    for (url in https.globalAgent.sockets) {
      openSockets[`https://${url}`] = https.globalAgent.sockets[url].map(
        socket => socket._httpMessage.path
      )
    }
    const targetDir = '/var/lib/overleaf/data'
    let directorySizeBytes = null
    try {
      directorySizeBytes = await dirSize(targetDir)
    } catch (err) {
      logger.error('Failed to get directory size', { error: err, targetDir })
      directorySizeBytes = null
    }

    SystemMessageManager.getMessagesFromDB(function (error, systemMessages) {
      if (error) {
        return next(error)
      }
      res.render('admin/index', {
        title: 'System Admin',
        openSockets,
        systemMessages,
	directorySizeBytes,
      })
    })
  },

  disconnectAllUsers: (req, res) => {
    logger.warn('disconecting everyone')
    const delay = (req.query && req.query.delay) > 0 ? req.query.delay : 10
    AdminController._sendDisconnectAllUsersMessage(delay)
    res.redirect('/admin#open-close-editor')
  },

  openEditor(req, res) {
    logger.warn('opening editor')
    Settings.editorIsOpen = true
    res.redirect('/admin#open-close-editor')
  },

  closeEditor(req, res) {
    logger.warn('closing editor')
    Settings.editorIsOpen = req.body.isOpen
    res.redirect('/admin#open-close-editor')
  },

  flushProjectToTpds(req, res, next) {
    TpdsProjectFlusher.flushProjectToTpds(req.body.project_id, error => {
      if (error) {
        return next(error)
      }
      res.sendStatus(200)
    })
  },

  pollDropboxForUser(req, res) {
    const { user_id: userId } = req.body
    TpdsUpdateSender.pollDropboxForUser(userId, () => res.sendStatus(200))
  },

  createMessage(req, res, next) {
    SystemMessageManager.createMessage(req.body.content, function (error) {
      if (error) {
        return next(error)
      }
      res.redirect('/admin#system-messages')
    })
  },

  clearMessages(req, res, next) {
    SystemMessageManager.clearMessages(function (error) {
      if (error) {
        return next(error)
      }
      res.redirect('/admin#system-messages')
    })
  },
  
  
}

module.exports = AdminController
