package runner

import "os"

// pipeWithClose returns a read end and write end of an OS pipe.
func pipeWithClose() (r *os.File, w *os.File, err error) {
	return os.Pipe()
}
