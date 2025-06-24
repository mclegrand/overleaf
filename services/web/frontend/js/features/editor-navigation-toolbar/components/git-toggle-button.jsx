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

function Modal({ isOpen, onClose, onCommit, onPush, notStagedFiles, stagedFiles, branches, selectedBranch, onSelectBranch, onCreateBranch}) {
  if (!isOpen) return null

  return (
    <div className="modal-overlay">
        <button onClick={onClose} className="modal-close-button">X</button>
        <div className="modal-content">
          <h2 style={{ fontFamily: 'sans-serif', fontWeight: 500 }}>Git Menu</h2>

          <div style={{ marginBottom: '15px' }}>
            <label htmlFor="new-branch" style={{ color: 'black' }}>Create New Branch</label>
            <div style={{ display: 'flex', gap: '8px', marginTop: '5px' }}>
              <input
                id="new-branch"
                type="text"
                placeholder="new-branch-name"
                style={{ flex: 1, padding: '5px', color: 'dimgray' }}
              />
              <button onClick={onCreateBranch} style={{ padding: '5px 10px', color: 'black' }}>
                Checkout
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label htmlFor="branch-select" style={{ color: 'black' }}>Select Branch</label>
            <select
              id="branch-select"
              value={selectedBranch}
              onChange={(e) => onSelectBranch(e.target.value)}
              style={{ width: '100%', padding: '5px', color: 'dimgray' }}
              disabled={branches.length === 0} // optional: disable dropdown until ready
            >
              {branches.length === 0 ? (
                <option>Loading branches...</option>
              ) : (
                branches.map((branch, idx) => (
                  <option key={idx} value={branch}>{branch}</option>
                ))
              )}
            </select>

          </div>
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
  const [branches, setBranches] = useState([])
  const [selectedBranch, setSelectedBranch] = useState('')

  const classes = classNames(
    'btn',
    'btn-full-height',
    'btn-full-height-no-border'
  )

  useEffect(() => {
    if (isModalOpen) {
      async function fetchGitData() {
        try {
          const branchesData = await getJSON(`/git-branches?projectId=${projectId}&userId=${userId}`);
          setBranches(branchesData);

          const currentBranch = await getJSON(`/git-currentbranch?projectId=${projectId}&userId=${userId}`);
          setSelectedBranch(currentBranch);

          const notStaged = await getJSON(`/git-notstaged?projectId=${projectId}&userId=${userId}`);
          setNotStagedFiles(notStaged);

          const staged = await getJSON(`/git-staged?projectId=${projectId}&userId=${userId}`);
          setStagedFiles(staged);
        } catch (error) {
          console.error(error);
        }
      }
      fetchGitData();
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
      .then(response => {
        alert("Commit successful");
      })
      .catch( error => {
        alert(error.data.errorReason);
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
      .then(response => {
        alert("Push successful");
      })
      .catch( error => {
        alert(error.data.errorReason);
      })
    )
    setIsModalOpen(false)
  }

  const handleSelectBranch = async (branchName) => {
    setSelectedBranch(branchName);  // optimistic UI update

    try {
      await runAsync(
        postJSON('/git-switch-branch', {
          body: { projectId, userId, branchName }
        })
      );

      const notStaged = await getJSON(`/git-notstaged?projectId=${projectId}&userId=${userId}`);
      setNotStagedFiles(notStaged);

      const staged = await getJSON(`/git-staged?projectId=${projectId}&userId=${userId}`);
      setStagedFiles(staged);

      const branchesData = await getJSON(`/git-branches?projectId=${projectId}&userId=${userId}`);
      setBranches(branchesData);

    } catch (error) {
      alert.error(error.data.errorReason);
    }
  }
  const handleCreateBranch = async () => {
    const input = document.getElementById('new-branch');
    const branchName = input?.value.trim();

    if (!branchName) {
      alert('Branch name cannot be empty');
      return;
    }

    try {
      await postJSON('/git-create-branch', {
        body: {
          projectId,
          userId,
          newBranchName: branchName,
        },
      });

      alert('Branch created');
      input.value = '';

      const notStaged = await getJSON(`/git-notstaged?projectId=${projectId}&userId=${userId}`);
      setNotStagedFiles(notStaged);

      const staged = await getJSON(`/git-staged?projectId=${projectId}&userId=${userId}`);
      setStagedFiles(staged);

      const branchesData = await getJSON(`/git-branches?projectId=${projectId}&userId=${userId}`);
      setBranches(branchesData);

      const currentBranch = await getJSON(`/git-currentbranch?projectId=${projectId}&userId=${userId}`);
      setSelectedBranch(currentBranch);

    } catch (err) {
      alert('Failed to create branch: ' + (err?.data?.errorReason || err.message));
    }
  };

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
        branches={branches}
        selectedBranch={selectedBranch}
        onSelectBranch={handleSelectBranch}
        onCreateBranch ={handleCreateBranch}
      />
    </div>
  )
}

export default GitToggleButton
