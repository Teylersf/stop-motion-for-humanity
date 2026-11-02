#!/usr/bin/env python3
"""Fetch exact source inputs serially, verifying pinned hashes or the x264 Git object."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, subprocess, tarfile, time, urllib.request, gzip, shutil
ROOT=Path(__file__).resolve().parents[1]
S=ROOT/"sources"; E=ROOT/"evidence"; S.mkdir(exist_ok=True); E.mkdir(exist_ok=True)
inputs=[
("ffmpeg","9.0.2","https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz","8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e","ffmpeg-9.0.2.tar.xz"),
("libvpx","1.17.0","https://github.com/webmproject/libvpx/archive/refs/tags/v1.17.0.tar.gz","1020f184046187baa2985dbde38e0691f49c44088bca7a1842b0236c6081dc0a","libvpx-1.17.0.tar.gz"),
("opus","1.6.1","https://ftp.osuosl.org/pub/xiph/releases/opus/opus-1.6.1.tar.gz","6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1","opus-1.6.1.tar.gz"),
("pkgconf","3.0.10","https://distfiles.ariadne.space/pkgconf/pkgconf-3.0.10.tar.xz","9371b2f6372da574d4c6dc96fe9b1463037bcf6afcb6671c1555afde7b17e2de","pkgconf-3.0.10.tar.xz")]
records=[]
def sha(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
 return h.hexdigest()
def save():
 (E/"source-inputs.json").write_text(json.dumps({"schema_version":1,"created_utc":datetime.now(timezone.utc).isoformat(),"sources":records},indent=2)+"\n")
for name,version,url,expected,filename in inputs:
 p=S/filename
 if p.exists():
  if sha(p)!=expected:raise SystemExit("Existing archive has wrong hash; preserved: "+str(p))
 else:
  request=urllib.request.Request(url,headers={"User-Agent":"StopMotionForHumanity-source-build/1"})
  with urllib.request.urlopen(request,timeout=90) as response:
   length=response.headers.get("Content-Length")
   if length and int(length)>100_000_000:raise SystemExit("Source exceeds100MB: report before downloading "+url)
   total=0
   part=p.with_suffix(p.suffix+".part")
   with part.open("xb") as output:
    while True:
     b=response.read(1024*1024)
     if not b:break
     total+=len(b)
     if total>100_000_000:raise SystemExit("Unexpected download exceeds100MB; stopped "+url)
     output.write(b)
   if sha(part)!=expected:raise SystemExit("Downloaded source hash mismatch; preserved "+str(part))
   part.rename(p)
 rec={"name":name,"version":version,"url":url,"archive":filename,"bytes":p.stat().st_size,"sha256":sha(p),"expected_sha256":expected,"verified":True}
 records.append(rec);save();print(json.dumps(rec),flush=True)
 with tarfile.open(p) as archive:
  roots={m.name.split("/")[0] for m in archive.getmembers() if m.name and m.name.split("/")[0] not in ["","."]}
  if len(roots)!=1:raise SystemExit("Unexpected archive root")
  extracted=S/next(iter(roots))
  if not extracted.exists():archive.extractall(S,filter="data")
gitdir=S/"x264-git"; commit="b35605ace3ddf7c1a5d67a2eb553f034aef41d55"; url="https://code.videolan.org/videolan/x264.git"
if not gitdir.exists():
 subprocess.run(["git","clone","--depth","1","--branch","stable",url,str(gitdir)],check=True)
actual=subprocess.check_output(["git","-C",str(gitdir),"rev-parse","HEAD"],text=True).strip()
if actual!=commit:
 subprocess.run(["git","-C",str(gitdir),"fetch","--depth","1","origin",commit],check=True)
 subprocess.run(["git","-C",str(gitdir),"checkout","--detach",commit],check=True)
assert subprocess.check_output(["git","-C",str(gitdir),"rev-parse","HEAD"],text=True).strip()==commit
subprocess.run(["git","-C",str(gitdir),"fsck","--full"],check=True)
archive=S/("x264-"+commit+".tar.gz")
if not archive.exists():
 with archive.open("xb") as output:
  with gzip.GzipFile(fileobj=output,mode="wb",filename="",mtime=0) as compressed:
   proc=subprocess.Popen(["git","-C",str(gitdir),"archive","--format=tar","--prefix=x264-"+commit+"/",commit],stdout=subprocess.PIPE)
   shutil.copyfileobj(proc.stdout,compressed)
   if proc.wait()!=0:raise SystemExit("git archive failed")
with tarfile.open(archive) as tar:
 extracted=S/("x264-"+commit)
 if not extracted.exists():tar.extractall(S,filter="data")
rec={"name":"x264","version":"r3222","url":url,"git_commit":commit,"git_object_integrity":"git fsck --full passed; exact pinned HEAD","archive":archive.name,"bytes":archive.stat().st_size,"sha256":sha(archive),"archive_creation":"Deterministic git archive of pinned commit, gzip mtime0","verified":True}
records.append(rec);save();print(json.dumps(rec),flush=True)

