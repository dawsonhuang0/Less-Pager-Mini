#!/usr/bin/env python3
"""runpty, but with the keys sent in stages so each command completes.

tests/runpty.py writes every key in one call. For F that is unusable:
F and the ^C that stops it arrive together, so the pager may never run
the jump at all and the screen you compare is the one it started with.

usage: runpty_staged.py ROWS COLS HEX,HEX,... -- cmd [args...]
       RUNPTY_DELAY   seconds before the first stage
       RUNPTY_STAGE   seconds between stages (default 1.0)
"""
import os, pty, sys, fcntl, termios, struct, select, time

rows, cols, groups = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
assert sys.argv[4] == '--'
argv = sys.argv[5:]
stages = [bytes.fromhex(g) for g in groups.split(',') if g]

pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

gap = float(os.environ.get('RUNPTY_STAGE', '1.0'))
send_at = time.time() + float(os.environ.get('RUNPTY_DELAY', '1.0'))
out = bytearray()
deadline = time.time() + 10 + gap * len(stages)

while time.time() < deadline:
    if stages and time.time() >= send_at:
        os.write(fd, stages.pop(0))
        send_at = time.time() + gap
    r, _, _ = select.select([fd], [], [], 0.05)
    if r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        out += data
    if not stages and os.waitpid(pid, os.WNOHANG)[0] != 0:
        while True:
            r, _, _ = select.select([fd], [], [], 0.05)
            if not r:
                break
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            out += data
        break

try:
    os.close(fd)
except OSError:
    pass
sys.stdout.buffer.write(bytes(out))
