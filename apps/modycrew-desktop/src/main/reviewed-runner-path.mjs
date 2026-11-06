// External Python/Node processes cannot read Electron's virtual ASAR filesystem.
// Keep these scripts unpacked and pass their physical paths to child processes.
export function reviewedRunnerPath(file) {
  return file.replace(/([\\/])app\.asar([\\/])/u, '$1app.asar.unpacked$2');
}
