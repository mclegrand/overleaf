import { useTranslation } from 'react-i18next'
import * as eventTracking from '../../../infrastructure/event-tracking'

import { Button } from 'react-bootstrap'

import { useProjectContext } from '@/shared/context/project-context'
import { useUserContext } from '../../../shared/context/user-context'
import { useEditorContext } from '../../../shared/context/editor-context'
import { useFileTreeActionable } from '../contexts/file-tree-actionable'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import OLTooltip from '@/features/ui/components/ol/ol-tooltip'
import MaterialIcon from '@/shared/components/material-icon'
import OLButtonToolbar from '@/features/ui/components/ol/ol-button-toolbar'
import importOverleafModules from '../../../../macros/import-overleaf-module.macro'
import React, { ElementType } from 'react'

const fileTreeToolbarComponents = importOverleafModules(
  'fileTreeToolbarComponents'
) as { import: { default: ElementType }; path: string }[]


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
  const { fileTreeReadOnly } = useFileTreeData()
  const { t } = useTranslation()

  if (fileTreeReadOnly) return null

  return (
    <OLButtonToolbar
      className="toolbar toolbar-filetree"
      aria-label={t('project_files')}
    >
      <FileTreeToolbarLeft />
      <FileTreeToolbarRight />
    </OLButtonToolbar>
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
      <OLTooltip
        id="new-file"
        description={t('new_file')}
        overlayProps={{ placement: 'bottom' }}
      >
        <button className="btn" onClick={createWithAnalytics}>
          <MaterialIcon type="description" accessibilityLabel={t('new_file')} />
        </button>
      </OLTooltip>
      <OLTooltip
        id="new-folder"
        description={t('new_folder')}
        overlayProps={{ placement: 'bottom' }}
      >
        <button className="btn" onClick={startCreatingFolder} tabIndex={-1}>
          <MaterialIcon type="folder" accessibilityLabel={t('new_folder')} />
        </button>
      </OLTooltip>
      <OLTooltip
        id="upload"
        description={t('upload')}
        overlayProps={{ placement: 'bottom' }}
      >
        <button className="btn" onClick={uploadWithAnalytics} tabIndex={-1}>
          <MaterialIcon type="upload" accessibilityLabel={t('upload')} />
        </button>
      </OLTooltip>
      <OLTooltip
        id="pull"
        description='Pull'
        overlayProps={{ placement: 'bottom' }}
      >
      <Button onClick={() => {
        runAsync(
            postJSON('/git-pull', {
              body:{
                projectId: projectId,
                userId: userId
              }
            })
            .then(response => {
                alert("Pull successful");
            })
            .catch( error => {
                alert(error.data.errorReason);
            })
        );
      }}>
        <MaterialIcon type="repeat" fw accessibilityLabel={t('pull')} />
      </Button>
    </OLTooltip>
    </div>
  )
}

function FileTreeToolbarRight() {
  const { t } = useTranslation()
  const { canRename, canDelete, startRenaming, startDeleting } =
    useFileTreeActionable()

  return (
    <div className="toolbar-right">
      {fileTreeToolbarComponents.map(
        ({ import: { default: Component }, path }) => (
          <Component key={path} />
        )
      )}

      {canRename ? (
        <OLTooltip
          id="rename"
          description={t('rename')}
          overlayProps={{ placement: 'bottom' }}
        >
          <button className="btn" onClick={startRenaming} tabIndex={-1}>
            <MaterialIcon type="edit" accessibilityLabel={t('rename')} />
          </button>
        </OLTooltip>
      ) : null}

      {canDelete ? (
        <OLTooltip
          id="delete"
          description={t('delete')}
          overlayProps={{ placement: 'bottom' }}
        >
          <button className="btn" onClick={startDeleting} tabIndex={-1}>
            <MaterialIcon type="delete" accessibilityLabel={t('delete')} />
          </button>
        </OLTooltip>
      ) : null}
    </div>
  )
}

export default FileTreeToolbar
