import { useTranslation } from 'react-i18next'
import * as eventTracking from '../../../infrastructure/event-tracking'

import { Button } from 'react-bootstrap'
import Tooltip from '../../../shared/components/tooltip'
import Icon from '../../../shared/components/icon'

import { useProjectContext } from '@/shared/context/project-context'
import { useUserContext } from '../../../shared/context/user-context'
import { useEditorContext } from '../../../shared/context/editor-context'
import { useFileTreeActionable } from '../contexts/file-tree-actionable'


import useAsync from '../../../shared/hooks/use-async'
import {
  getUserFacingMessage,
  postJSON,
} from '../../../infrastructure/fetch-json'

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

function FileTreeToolbar() {
  const { permissionsLevel } = useEditorContext()

  if (permissionsLevel === 'readOnly') return null

  return (
    <div className="toolbar toolbar-filetree">
      <FileTreeToolbarLeft />
      <FileTreeToolbarRight />
    </div>
  )
}

function FileTreeToolbarLeft() {
  const { isLoading, isError, error, runAsync } = useAsync<NewProjectData>()
  const { t } = useTranslation()
  const { id: userId } = useUserContext()
  const { _id: projectId } = useProjectContext()

  const {
    canCreate,
    startCreatingFolder,
    startCreatingDocOrFile,
    startUploadingDocOrFile,
  } = useFileTreeActionable()

  const createWithAnalytics = () => {
    eventTracking.sendMB('new-file-click', { location: 'toolbar' })
    startCreatingDocOrFile()
  }

  const uploadWithAnalytics = () => {
    eventTracking.sendMB('upload-click', { location: 'toolbar' })
    startUploadingDocOrFile()
  }

  if (!canCreate) return null

  return (
    <div className="toolbar-left">
      <Tooltip
        id="new-file"
        description={t('new_file')}
        overlayProps={{ placement: 'bottom' }}
      >
        <Button onClick={createWithAnalytics} bsStyle={null}>
          <Icon type="file" fw accessibilityLabel={t('new_file')} />
        </Button>
      </Tooltip>
      <Tooltip
        id="new-folder"
        description={t('new_folder')}
        overlayProps={{ placement: 'bottom' }}
      >
        <Button onClick={startCreatingFolder} bsStyle={null}>
          <Icon type="folder" fw accessibilityLabel={t('new_folder')} />
        </Button>
      </Tooltip>
      <Tooltip
        id="upload"
        description={t('upload')}
        overlayProps={{ placement: 'bottom' }}
      >
        <Button onClick={uploadWithAnalytics}>
          <Icon type="upload" fw accessibilityLabel={t('upload')} />
        </Button>
      </Tooltip>
    </div>
  )
}

function FileTreeToolbarRight() {
  const { t } = useTranslation()
  const { canRename, canDelete, startRenaming, startDeleting } =
    useFileTreeActionable()

  if (!canRename && !canDelete) {
    return null
  }

  return (
    <div className="toolbar-right">
      {canRename ? (
        <Tooltip
          id="rename"
          description={t('rename')}
          overlayProps={{ placement: 'bottom' }}
        >
          <Button onClick={startRenaming}>
            <Icon type="pencil" fw accessibilityLabel={t('rename')} />
          </Button>
        </Tooltip>
      ) : null}
      {canDelete ? (
        <Tooltip
          id="delete"
          description={t('delete')}
          overlayProps={{ placement: 'bottom' }}
        >
          <Button onClick={startDeleting}>
            <Icon type="trash-o" fw accessibilityLabel={t('delete')} />
          </Button>
        </Tooltip>
      ) : null}
    </div>
  )
}

export default FileTreeToolbar
