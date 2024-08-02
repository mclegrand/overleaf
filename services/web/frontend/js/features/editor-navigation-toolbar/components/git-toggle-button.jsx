import PropTypes from 'prop-types'
import classNames from 'classnames'
import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { useProjectContext } from '@/shared/context/project-context'
import { useUserContext } from '../../../shared/context/user-context'
import Icon from '../../../shared/components/icon'
import './Modal.css'

import useAsync from '../../../shared/hooks/use-async'
import {
  getJSON,
  postJSON,
} from '../../../infrastructure/fetch-json'

function Modal({ isOpen, onClose, onCommit, onPush, notStagedFiles, stagedFiles}) {
  if (!isOpen) return null

  return (
    <div className="modal-overlay">
        <button onClick={onClose} className="modal-close-button">X</button>
        <div className="modal-content">
          <h2 style={{ fontFamily: 'sans-serif', fontWeight: 500 }}>Git Menu</h2>
          <div>
            <label htmlFor="commit-message">Commit message</label>
            <textarea id="commit-message" rows="4" style={{ width: '100%' }}></textarea>
          </div>
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button onClick={onCommit} style={{ width: '100%', marginBottom: '10px' }}>Commit</button>
            <button onClick={onPush} style={{ width: '100%' }}>Push</button>
          </div>
        <div style={{ marginTop: '20px' }}>
          <h3>Modified files (not staged)</h3>
          <ul>
            {notStagedFiles.map((file, index) => (
              <li key={index}>{file}</li>
            ))}
          </ul>
        </div>
        <div style={{ marginTop: '20px' }}>
          <h3>Staged files</h3>
          <ul>
            {stagedFiles.map((file, index) => (
              <li key={index}>{file}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function GitToggleButton() {

  const { id: userId } = useUserContext()
  const { _id: projectId } = useProjectContext()
  const { isLoading, isSuccess, isError, error, runAsync } = useAsync()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [notStagedFiles, setNotStagedFiles] = useState([])
  const [stagedFiles, setStagedFiles] = useState([])

  const classes = classNames(
    'btn',
    'btn-full-height',
    'btn-full-height-no-border'
  )

  useEffect(() => {
    if (isModalOpen) {
      getJSON(`/git-notstaged?projectId=${projectId}&userId=${userId}`).then(setNotStagedFiles).catch(console.error)
      getJSON(`/git-staged?projectId=${projectId}&userId=${userId}`).then(setStagedFiles).catch(console.error)
    }
  }, [isModalOpen]);

  const handleButtonClick = (event) => {
    event.stopPropagation()
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleCommit = () => {
    const commitMessageInput = document.getElementById('commit-message')
    const message = commitMessageInput.value
    runAsync(
      postJSON('/git-commit', {
        body:{
          projectId: projectId,
          userId: userId,
          message: message
        }
      })
    )
    setIsModalOpen(false)
  }

  const handlePush = () => {
    runAsync(
      postJSON('/git-push', {
        body:{
          projectId: projectId,
          userId: userId
        }
      })
    )
    setIsModalOpen(false)
  }

  return (
    <div className="toolbar-item">
      <button className={classes} onClick={handleButtonClick}>
        <Icon type="comment" fw className={''} />
        <p className="toolbar-label">{'Git menu'}</p>
      </button>
      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onCommit={handleCommit}
        onPush={handlePush}
        notStagedFiles={notStagedFiles}
        stagedFiles={stagedFiles}
      />
    </div>
  )
}

export default GitToggleButton
