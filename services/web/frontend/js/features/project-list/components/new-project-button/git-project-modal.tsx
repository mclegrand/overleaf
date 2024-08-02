import AccessibleModal from '../../../../shared/components/accessible-modal'
import ModalContentNewProjectForm from './modal-content-new-git-project-form'

type GitProjectModalProps = {
  onHide: () => void
}

function GitProjectModal({ onHide }: GitProjectModalProps) {
  return (
    <AccessibleModal
      show
      animation
      onHide={onHide}
      id="git-project-modal"
      backdrop="static"
    >
      <ModalContentNewProjectForm onCancel={onHide} template="git"/>
    </AccessibleModal>
  )
}

export default GitProjectModal
