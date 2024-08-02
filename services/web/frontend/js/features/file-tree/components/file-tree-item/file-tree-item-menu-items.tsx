import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import * as eventTracking from '../../../../infrastructure/event-tracking'
import { useProjectContext } from '@/shared/context/project-context'
import { useUserContext } from '../../../../shared/context/user-context'
import { MenuItem } from 'react-bootstrap'
import { useFileTreeActionable } from '../../contexts/file-tree-actionable'
import { copyDirectory } from '../../../../shared/utils/storage-handler'

import useAsync from '../../../../shared/hooks/use-async'
import {
  getUserFacingMessage,
  postJSON,
} from '../../../../infrastructure/fetch-json'

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


function FileTreeItemMenuItems() {
  const { isLoading, isError, error, runAsync } = useAsync<NewProjectData>()

  const { id: userId } = useUserContext()
  const { _id: projectId } = useProjectContext()
  const { t } = useTranslation()

  const {
    canRename,
    canDelete,
    canCreate,
    parentFolderID,
    startRenaming,
    startDeleting,
    startCreatingFolder,
    startCreatingDocOrFile,
    startUploadingDocOrFile,
    downloadPath,
    selectedFileName,
    selectedFilePath
  } = useFileTreeActionable()

  const { owner } = useProjectContext()

  const downloadWithAnalytics = useCallback(() => {
    // we are only interested in downloads of bib files WRT analytics, for the purposes of promoting the tpr integrations
    if (selectedFileName?.endsWith('.bib')) {
      eventTracking.sendMB('download-bib-file', { projectOwner: owner._id })
    }
  }, [selectedFileName, owner])

  const createWithAnalytics = useCallback(() => {
    eventTracking.sendMB('new-file-click', { location: 'file-menu' })
    startCreatingDocOrFile()
  }, [startCreatingDocOrFile])

  const uploadWithAnalytics = useCallback(() => {
    eventTracking.sendMB('upload-click', { location: 'file-menu' })
    startUploadingDocOrFile()
  }, [startUploadingDocOrFile])
  return(
    <>
      {canRename ? (
        <MenuItem onClick={startRenaming}>{t('rename')}</MenuItem>
      ) : null}
      {downloadPath ? (
        <MenuItem href={downloadPath} onClick={downloadWithAnalytics} download>
          {t('download')}
        </MenuItem>
      ) : null}
      {canDelete ? (
        <MenuItem onClick={startDeleting}>{t('delete')}</MenuItem>
      ) : null}
      {canCreate ? (
        <>
          <MenuItem divider />
          <MenuItem onClick={createWithAnalytics}>{t('new_file')}</MenuItem>
          <MenuItem onClick={startCreatingFolder}>{t('new_folder')}</MenuItem>
          <MenuItem onClick={uploadWithAnalytics}>{t('upload')}</MenuItem>
        </>
      ) : null}
      {canDelete ? (
        <MenuItem onClick={() => {
            runAsync(
               postJSON('/git-add', {
                 body:{
                    projectId: projectId,
                    userId: userId,
                    filePath: selectedFilePath
                 }
              })
            )
      }}>Add</MenuItem>
      ) : null}
    </>
  )
}

export default FileTreeItemMenuItems
