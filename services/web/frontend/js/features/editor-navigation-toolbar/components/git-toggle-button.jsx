
// git-toggle-button.jsx - Corrections pour l'affichage et le rollback

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

function Modal({ isOpen, onClose, onCommit, onPush, onRollback, notStagedFiles, stagedFiles, commitHistory, isRollbackLoading}) {
  const [activeTab, setActiveTab] = useState('commit')
  const [selectedCommit, setSelectedCommit] = useState('')

  if (!isOpen) return null

  return (
    <div className="modal-overlay">
        <button onClick={onClose} className="modal-close-button">X</button>
        <div className="modal-content">
          <h2 style={{ fontFamily: 'sans-serif', fontWeight: 500 }}>Git Menu</h2>
          
          {/* Tabs */}
          <div style={{ display: 'flex', marginBottom: '20px', borderBottom: '1px solid #ddd' }}>
            <button 
              onClick={() => setActiveTab('commit')}
              style={{ 
                padding: '10px 20px', 
                border: 'none', 
                backgroundColor: activeTab === 'commit' ? '#007bff' : 'transparent',
                color: activeTab === 'commit' ? 'white' : 'black',
                cursor: 'pointer'
              }}
            >
              Commit & Push
            </button>
            <button 
              onClick={() => setActiveTab('rollback')}
              style={{ 
                padding: '10px 20px', 
                border: 'none', 
                backgroundColor: activeTab === 'rollback' ? '#007bff' : 'transparent',
                color: activeTab === 'rollback' ? 'white' : 'black',
                cursor: 'pointer'
              }}
            >
              Rollback
            </button>
          </div>

          {/* Commit & Push Tab */}
          {activeTab === 'commit' && (
            <>
              <div>
                <label htmlFor="commit-message" style={{ color: 'black' }}>Commit message</label>
                <textarea id="commit-message" rows="4" style={{ color: 'dimgray', width: '100%' }}></textarea>
              </div>
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <button onClick={onCommit} style={{ color: 'black', width: '100%', marginBottom: '10px' }}>Commit</button>
                <button onClick={onPush} style={{ color: 'black', width: '100%' }}>Push</button>
              </div>
              <div style={{ marginTop: '20px' }}>
                <h3>Modified files (not staged)</h3>
                <ul>
                  {notStagedFiles.map((file, index) => (
                    <li key={index} style={{ color: 'black' }}>{file}</li>
                  ))}
                </ul>
              </div>
              <div style={{ marginTop: '20px' }}>
                <h3>Staged files</h3>
                <ul>
                  {stagedFiles.map((file, index) => (
                    <li key={index} style={{ color: 'black' }}>{file}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {/* Rollback Tab */}
          {activeTab === 'rollback' && (
            <>
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ color: 'black', marginBottom: '10px' }}>Recent Commits</h3>
                <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #ddd', padding: '10px' }}>
                  {commitHistory.length > 0 ? (
                    commitHistory.map((commit, index) => (
                      <div 
                        key={commit.hash} 
                        style={{ 
                          marginBottom: '10px', 
                          padding: '10px', 
                          border: selectedCommit === commit.hash ? '2px solid #007bff' : '1px solid #eee',
                          borderRadius: '5px',
                          cursor: 'pointer',
                          backgroundColor: selectedCommit === commit.hash ? '#f0f8ff' : 'white'
                        }}
                        onClick={() => setSelectedCommit(commit.hash)}
                      >
                        <div style={{ fontWeight: 'bold', color: '#007bff', fontSize: '12px', fontFamily: 'monospace' }}>
                          {commit.hash.substring(0, 7)}
                        </div>
                        <div style={{ color: 'black', marginTop: '5px', fontWeight: '500' }}>
                          {commit.message || 'No commit message'}
                        </div>
                        {commit.author && (
                          <div style={{ color: 'gray', fontSize: '11px', marginTop: '3px' }}>
                            by {commit.author}
                          </div>
                        )}
                        {commit.date && (
                          <div style={{ color: 'gray', fontSize: '11px', marginTop: '3px' }}>
                            {new Date(commit.date).toLocaleString()}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div style={{ color: 'gray', textAlign: 'center', padding: '20px' }}>
                      No commit history available
                    </div>
                  )}
                </div>
              </div>
              
              {selectedCommit && (
                <div style={{ marginTop: '20px' }}>
                  <div style={{ 
                    padding: '10px', 
                    backgroundColor: '#fff3cd', 
                    border: '1px solid #ffeaa7', 
                    borderRadius: '5px',
                    marginBottom: '15px'
                  }}>
                    <strong style={{ color: '#856404' }}>⚠️ Warning:</strong>
                    <div style={{ color: '#856404', marginTop: '5px' }}>
                      Rolling back will reset your project to commit <code>{selectedCommit.substring(0, 7)}</code>. 
                      All changes after this commit will be lost permanently.
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => onRollback(selectedCommit)}
                    disabled={isRollbackLoading}
                    style={{ 
                      backgroundColor: isRollbackLoading ? '#6c757d' : '#dc3545', 
                      color: 'white', 
                      border: 'none',
                      padding: '10px 20px',
                      borderRadius: '5px',
                      cursor: isRollbackLoading ? 'not-allowed' : 'pointer',
                      width: '100%'
                    }}
                  >
                    {isRollbackLoading ? 'Rolling back...' : 'Rollback to this commit'}
                  </button>
                </div>
              )}
            </>
          )}
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
  const [commitHistory, setCommitHistory] = useState([])
  const [isRollbackLoading, setIsRollbackLoading] = useState(false)

  const classes = classNames(
    'btn',
    'btn-full-height',
    'btn-full-height-no-border'
  )

  useEffect(() => {
    if (isModalOpen) {
      // Charger les données existantes
      loadGitData()
    }
  }, [isModalOpen]);

  const loadGitData = async () => {
    try {
      const [notStaged, staged, commits] = await Promise.all([
        getJSON(`/git-notstaged?projectId=${projectId}&userId=${userId}`),
        getJSON(`/git-staged?projectId=${projectId}&userId=${userId}`),
        getJSON(`/git-commits?projectId=${projectId}&userId=${userId}&limit=20`)
      ])
      
      setNotStagedFiles(notStaged)
      setStagedFiles(staged)
      setCommitHistory(commits)
    } catch (error) {
      console.error('Error loading git data:', error)
    }
  }

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
    
    if (!message.trim()) {
      alert('Please enter a commit message')
      return
    }
    
    runAsync(
      postJSON('/git-commit', {
        body:{
          projectId: projectId,
          userId: userId,
          message: message
        }
      })
    ).then(() => {
      // Recharger les données après le commit
      loadGitData()
    })
    
    // Vider le champ de message
    commitMessageInput.value = ''
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
  }

  const handleRollback = async (commitHash) => {
    if (!commitHash) {
      alert('Please select a commit to rollback to')
      return
    }

    const confirmed = window.confirm(
      `Are you sure you want to rollback to commit ${commitHash.substring(0, 7)}? This action cannot be undone and will permanently lose all changes after this commit.`
    )

    if (confirmed) {
      setIsRollbackLoading(true)
      
      try {
        const response = await postJSON('/git-rollback', {
          body: {
            projectId: projectId,
            userId: userId,
            commitHash: commitHash
          }
        })
        
        if (response.success) {
          alert(`Successfully rolled back to commit ${commitHash.substring(0, 7)}. Please refresh the page to see the changes.`)
          // Fermer la modal et rafraîchir la page
          setIsModalOpen(false)
          window.location.reload()
        } else {
          throw new Error(response.error || 'Rollback failed')
        }
        
      } catch (error) {
        console.error('Rollback error:', error)
        alert(`Rollback failed: ${error.message}. Please check the console for more details.`)
      } finally {
        setIsRollbackLoading(false)
      }
    }
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
        onRollback={handleRollback}
        notStagedFiles={notStagedFiles}
        stagedFiles={stagedFiles}
        commitHistory={commitHistory}
        isRollbackLoading={isRollbackLoading}
      />
    </div>
  )
}

export default GitToggleButton