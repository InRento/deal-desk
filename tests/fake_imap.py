"""Minimal fake Gmail IMAP server (plain TCP) for testing Deal Desk's read-only sync.
Speaks: CAPABILITY, LOGIN, LIST, EXAMINE/SELECT, UID SEARCH (ALL | X-GM-THRID n), UID FETCH, NOOP, LOGOUT.
Logs every command to <log>; the test asserts nothing writes (no SELECT, STORE, COPY, non-PEEK BODY[]).
Usage: python3 fakeimap.py PORT fixture.json log.txt
"""
import base64, json, re, socketserver, sys

PORT, FIX, LOG = int(sys.argv[1]), sys.argv[2], sys.argv[3]


def mutf7_decode(s):
    def dec(m):
        b = m.group(1)
        if not b:
            return "&"
        b = b.replace(",", "/")
        return base64.b64decode(b + "=" * (-len(b) % 4)).decode("utf-16-be")
    return re.sub(r"&([^-]*)-", dec, s)


def mutf7_encode(s):
    out, buf = [], []
    def flush():
        if buf:
            out.append("&" + base64.b64encode("".join(buf).encode("utf-16-be")).decode().rstrip("=").replace("/", ",") + "-"); buf.clear()
    for ch in s:
        if 0x20 <= ord(ch) <= 0x7E:
            flush(); out.append("&-" if ch == "&" else ch)
        else:
            buf.append(ch)
    flush()
    return "".join(out)


def load():
    fx = json.load(open(FIX))
    boxes = {}  # name -> list of message dicts in uid order
    for name in fx["mailboxes"]:
        boxes[name] = []
    for m in sorted(fx["messages"], key=lambda m: m["msgid"]):
        for lb in m["labels"] + ["[Gmail]/All Mail"]:
            boxes.setdefault(lb, []).append(m)
    return fx, boxes


class H(socketserver.StreamRequestHandler):
    def w(self, s):
        self.wfile.write(s if isinstance(s, bytes) else s.encode())

    def handle(self):
        fx, boxes = load()
        sel = None
        self.w("* OK Fake Gimap ready\r\n")
        while True:
            line = self.rfile.readline()
            if not line:
                return
            line = line.decode().rstrip("\r\n")
            open(LOG, "a").write(line + "\n")
            tag, _, rest = line.partition(" ")
            cmd, _, args = rest.partition(" ")
            cmd = cmd.upper()
            if cmd == "CAPABILITY":
                self.w("* CAPABILITY IMAP4rev1 X-GM-EXT-1 UIDPLUS\r\n" + f"{tag} OK done\r\n")
            elif cmd == "LOGIN":
                user, pw = re.findall(r'"([^"]*)"|(\S+)', args)[0][0] or args.split()[0], args.split()[-1].strip('"')
                if pw != fx["password"]:
                    self.w(f"{tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n")
                else:
                    self.w(f"{tag} OK Logged in\r\n")
            elif cmd == "LIST":
                for name in boxes:
                    flags = "\\HasNoChildren"
                    if name == "[Gmail]/All Mail":
                        flags += " \\All"
                    if name == "[Gmail]":
                        flags = "\\Noselect \\HasChildren"
                    self.w(f'* LIST ({flags}) "/" "{mutf7_encode(name)}"\r\n')
                self.w(f"{tag} OK Success\r\n")
            elif cmd in ("EXAMINE", "SELECT"):
                name = mutf7_decode(args.strip().strip('"').replace('\\"', '"'))
                if name not in boxes:
                    self.w(f"{tag} NO no such mailbox\r\n"); continue
                sel = boxes[name]
                self.w(f"* {len(sel)} EXISTS\r\n* OK [UIDVALIDITY {fx.get('uidvalidity', 7)}] UIDs valid\r\n")
                self.w(f"{tag} OK [{'READ-ONLY' if cmd == 'EXAMINE' else 'READ-WRITE'}] {name} selected\r\n")
            elif cmd == "UID":
                sub, _, a = args.partition(" ")
                sub = sub.upper()
                if sub == "SEARCH":
                    a = a.strip()
                    if a.upper() == "ALL":
                        uids = [i + 1 for i in range(len(sel))]
                    else:
                        t = re.search(r"X-GM-THRID (\d+)", a).group(1)
                        uids = [i + 1 for i, m in enumerate(sel) if str(m["thrid"]) == t]
                    self.w("* SEARCH " + " ".join(map(str, uids)) + f"\r\n{tag} OK SEARCH completed\r\n")
                elif sub == "FETCH":
                    rng, items = a.split(" ", 1)
                    want = set()
                    for part in rng.split(","):
                        if ":" in part:
                            x, y = part.split(":"); want.update(range(int(x), int(y) + 1))
                        else:
                            want.add(int(part))
                    for i, m in enumerate(sel):
                        uid = i + 1
                        if uid not in want:
                            continue
                        raw = m["raw"].replace("\n", "\r\n").encode()
                        hdr, _, txt = raw.partition(b"\r\n\r\n")
                        hdr += b"\r\n\r\n"
                        bs = " ".join(f'("application" "pdf" ("name" "{n}") NIL NIL "base64" 100 NIL ("attachment" ("filename" "{n}")) NIL NIL)' for n in m.get("bsatt", []))
                        out = f"* {uid} FETCH (X-GM-THRID {m['thrid']} X-GM-MSGID {m['msgid']} UID {uid}"
                        if "BODYSTRUCTURE" in items:
                            out += f' BODYSTRUCTURE (("text" "plain" ("charset" "utf-8") NIL NIL "7bit" 10 1 NIL NIL NIL NIL) {bs} "mixed")'
                        if "BODY.PEEK[HEADER]" in items:
                            self.w(out + f" BODY[HEADER] {{{len(hdr)}}}\r\n"); self.w(hdr)
                            lim = int(re.search(r"BODY\.PEEK\[TEXT\]<0\.(\d+)>", items).group(1))
                            t = txt[:lim]
                            self.w(f" BODY[TEXT]<0> {{{len(t)}}}\r\n"); self.w(t); self.w(")\r\n")
                        else:
                            self.w(out + ")\r\n")
                    self.w(f"{tag} OK Success\r\n")
                else:
                    self.w(f"{tag} BAD unsupported\r\n")
            elif cmd == "NOOP":
                self.w(f"{tag} OK\r\n")
            elif cmd == "LOGOUT":
                self.w("* BYE\r\n" + f"{tag} OK\r\n"); return
            else:
                self.w(f"{tag} BAD unknown {cmd}\r\n")


class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


S(("127.0.0.1", PORT), H).serve_forever()
