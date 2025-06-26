import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import * as eventTracking from '../../../../infrastructure/event-tracking'
import { useProjectContext } from '@/shared/context/project-context'
import {
  DropdownDivider,
  DropdownItem,
} from '@/features/ui/components/bootstrap-5/dropdown-menu'
import { useUserContext } from '../../../../shared/context/user-context'
// import { MenuItem } from 'react-bootstrap'
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
        <li role="none">
          <DropdownItem onClick={startRenaming}>{t('rename')}</DropdownItem>
        </li>
      ) : null}
      {downloadPath ? (
        <li role="none">
          <DropdownItem
            href={downloadPath}
            onClick={downloadWithAnalytics}
            download={selectedFileName ?? undefined}
          >
            {t('download')}
          </DropdownItem>
        </li>
      ) : null}
      {canDelete ? (
        <li role="none">
          <DropdownItem onClick={startDeleting}>{t('delete')}</DropdownItem>
        </li>
      ) : null}
      {canCreate ? (
        <>
          <DropdownDivider />
          <li role="none">
            <DropdownItem onClick={createWithAnalytics}>
              {t('new_file')}
            </DropdownItem>
          </li>
          <li role="none">
            <DropdownItem onClick={startCreatingFolder}>
              {t('new_folder')}
            </DropdownItem>
          </li>
          <li role="none">
            <DropdownItem onClick={uploadWithAnalytics}>
              {t('upload')}
            </DropdownItem>
          </li>
        </>
      ) : null}
      {canDelete ? (
        <DropdownItem onClick={() => {
            runAsync(
               postJSON('/git-add', {
                 body:{
                    projectId: projectId,
                    userId: userId,
                    filePath: selectedFilePath
                 }
              })
           .catch( error => {
               alert(error.data.errorReason);
           })
            )
      }}>Add</DropdownItem>
      ) : null}
    </>
  )
}

export default FileTreeItemMenuItems
