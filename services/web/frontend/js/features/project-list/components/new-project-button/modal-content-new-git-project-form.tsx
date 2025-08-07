import React, { useState } from 'react'
import { Alert, Button, Form, FormControl, Modal } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import useAsync from '../../../../shared/hooks/use-async'
import {
  getUserFacingMessage,
  postJSON,
} from '../../../../infrastructure/fetch-json'
import { useRefWithAutoFocus } from '../../../../shared/hooks/use-ref-with-auto-focus'
import { useLocation } from '../../../../shared/hooks/use-location'
import getMeta from '@/utils/meta'
import Notification from '@/shared/components/notification'

type NewProjectData = {
  project_id: string
  owner_ref: string
  owner: {
    first_name: string
    last_name: string
    email: string
    id: string
  }
}

type Props = {
  onCancel: () => void
  template?: string
}

function ModalContentNewGithubProjectForm({ onCancel, template = 'none' }: Props) {
  const { t } = useTranslation()
  const { autoFocusedRef } = useRefWithAutoFocus<HTMLInputElement>()
  const [projectName, setProjectName] = useState('')
  const { isLoading, isError, error, runAsync } = useAsync<NewProjectData>()
  const location = useLocation()
  const newNotificationStyle = getMeta(
    'ol-newNotificationStyle',
    false
  ) as boolean

  const createNewProject = () => {
    runAsync(
      postJSON('/project/new', {
        body: {
          _csrf: window.csrfToken,
          projectName,
          template,
        },
      })
    )
      .then(data => {
        if (data.project_id) {
          location.assign(`/project/${data.project_id}`)
        }
      })
      .catch(() => {})
  }

  const handleChangeName = (
    e: React.ChangeEvent<HTMLInputElement & FormControl>
  ) => {
    setProjectName(e.currentTarget.value)
  }

  const handleSubmit = (e: React.FormEvent<Form>) => {
    e.preventDefault()
    createNewProject()
  }

  return (
    <>
      <Modal.Header closeButton>
        <Modal.Title>{'Import project'}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {isError &&
          (newNotificationStyle ? (
            <div className="notification-list">
              <Notification
                type="error"
                content={getUserFacingMessage(error) as string}
              />
            </div>
          ) : (
            <Alert bsStyle="danger">{getUserFacingMessage(error)}</Alert>
          ))}
        <Form onSubmit={handleSubmit}>
          <input
            type="text"
            className="form-control"
            ref={autoFocusedRef}
            placeholder={'git@example.com:author/project.git'}
            onChange={handleChangeName}
            value={projectName}
          />
        </Form>
      </Modal.Body>

      <Modal.Footer>
        <Button bsStyle={null} className="btn-secondary" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          bsStyle="primary"
          onClick={createNewProject}
          disabled={projectName === '' || isLoading}
        >
          {isLoading ? `${'Importing'}…` : 'Import'}
        </Button>
      </Modal.Footer>
    </>
  )
}

export default ModalContentNewGithubProjectForm
