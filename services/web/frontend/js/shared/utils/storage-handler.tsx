import useAsync from '../hooks/use-async'
import {
  getUserFacingMessage,
  postJSON,
} from '../../infrastructure/fetch-json'

function copyDirectory(projectId: string, userId: string) {
  const src = '/var/lib/overleaf/data/output/' + projectId + '-' + userId;
  const dest = '/var/lib/overleaf/data/git/' + projectId + '-' + userId;

  console.log(dest);
  runAsync(
    postJSON('/copy-directory', {
       body:
         src,
         dest,
    })
   )
};

export default copyDirectory;
