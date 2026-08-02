#!/usr/bin/env python3
"""Run a command on a real pty of a given size, feed it keys, capture output.

`script -q /dev/null cmd < keys` cannot be used: when stdin closes, script
writes a literal EOF character (0x04) to the pty, and less reads ^D as
A_F_SCROLL -- a half-screen scroll that moves the top line before quit.
That silently corrupted every position-sensitive comparison.

usage: pty.py ROWS COLS KEYS_HEX -- cmd [args...]
"""
import os, pty, sys, fcntl, termios, struct, select, time

rows, cols, keyhex = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
assert sys.argv[4] == '--'
argv = sys.argv[5:]
keys = bytes.fromhex(keyhex)

pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

out = bytearray()
# Let the program finish drawing before typing, or the tty echoes the key
# into the middle of the screen. Slow cases (prep_hilite scanning a whole
# file) need longer, so the delay is settable.
send_at = time.time() + float(os.environ.get('RUNPTY_DELAY', '0.4'))
deadline = time.time() + 10
while time.time() < deadline:
    if keys and time.time() >= send_at:
        os.write(fd, keys)
        keys = b''
    r, _, _ = select.select([fd], [], [], 0.05)
    if r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        out += data
    if os.waitpid(pid, os.WNOHANG)[0] != 0:
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
