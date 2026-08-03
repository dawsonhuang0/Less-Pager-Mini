"""Run a command on a pty with NO controlling terminal.

pty.fork() makes the child a session leader owning the slave; forking
once more and calling setsid() in the grandchild detaches it, so
/dev/tty fails while fds 0/1/2 still point at the terminal - exactly
what `setsid`, some CI runners and container shells produce.
"""
import os, pty, sys, fcntl, termios, struct, select, time
rows, cols, keyhex = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
assert sys.argv[4] == '--'
argv = sys.argv[5:]
keys = bytes.fromhex(keyhex)
pid, fd = pty.fork()
if pid == 0:
    if os.fork() == 0:
        os.setsid()                      # drop the controlling terminal
        try:
            os.close(os.open('/dev/tty', os.O_RDONLY))
            os._exit(99)                 # still attached: test is invalid
        except OSError:
            pass
        os.execvp(argv[0], argv)
    os.wait()
    os._exit(0)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
out = bytearray()
send_at = time.time() + float(os.environ.get('RUNPTY_DELAY', '1.0'))
deadline = time.time() + 8
while time.time() < deadline:
    if keys and time.time() >= send_at:
        os.write(fd, keys); keys = b''
    r, _, _ = select.select([fd], [], [], 0.05)
    if r:
        try: data = os.read(fd, 65536)
        except OSError: break
        if not data: break
        out += data
    if os.waitpid(pid, os.WNOHANG)[0] != 0:
        while True:
            r, _, _ = select.select([fd], [], [], 0.05)
            if not r: break
            try: data = os.read(fd, 65536)
            except OSError: break
            if not data: break
            out += data
        break
os.close(fd)
sys.stdout.buffer.write(bytes(out))
