#!/usr/bin/env python3
"""Serial verified pro-codec inputs; private CMake binary is a build tool only."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,urllib.request,tarfile,gzip,subprocess,shutil
ROOT=Path(__file__).resolve().parents[1];S=ROOT/"sources";E=ROOT/"evidence";TOOLS=ROOT/"tools";TOOLS.mkdir(exist_ok=True)
records=json.loads((E/"source-inputs.json").read_text())["sources"]
def digest(p):
 h=hashlib.sha256()
 with p.open("rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
 return h.hexdigest()
def save(record):
 global records
 records=[r for r in records if r["name"]!=record["name"]]+[record]
 (E/"source-inputs.json").write_text(json.dumps({"schema_version":1,"created_utc":datetime.now(timezone.utc).isoformat(),"sources":records},indent=2)+"\n")
 print(json.dumps(record),flush=True)
def fetch(url,path,expected):
 if path.exists():
  assert digest(path)==expected,("Existing input mismatch",str(path));return
 with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"StopMotionForHumanity-source-build/1"}),timeout=120) as response:
  length=response.headers.get("Content-Length")
  if length and int(length)>100_000_000:raise SystemExit("Input exceeds100MB: report before download "+url)
  part=path.with_suffix(path.suffix+".part");total=0
  with part.open("xb") as f:
   while True:
    b=response.read(1024*1024)
    if not b:break
    total+=len(b)
    if total>100_000_000:raise SystemExit("Unexpected input exceeds100MB; stopped")
    f.write(b)
  assert digest(part)==expected,("Downloaded input mismatch",str(part))
  part.rename(path)
def extract(path,destination):
 with tarfile.open(path) as t:
  roots={m.name.split("/")[0] for m in t.getmembers() if m.name and m.name.split("/")[0] not in ["","."]}
  assert len(roots)==1,roots
  if not (destination/next(iter(roots))).exists():t.extractall(destination,filter="data")
for name,version,url,expected,file in [
 ("x265","4.3","https://github.com/Multicorewareinc/x265/releases/download/4.3/x265_4.3.tar.gz","83c53e4c8bbb8f1e33ed59e10a7d621d1d7801ca853910c3eb41f038b8ffb121","x265_4.3.tar.gz"),
 ("cmake","4.4.5","https://github.com/Kitware/CMake/releases/download/v4.4.5/cmake-4.4.5.tar.gz","a0c54c88abb8078dd8eccadb717fc6bb194bf18e7d44c86309910288886e04e2","cmake-4.4.5.tar.gz")]:
 p=S/file;fetch(url,p,expected);extract(p,S)
 save({"name":name,"version":version,"url":url,"archive":file,"bytes":p.stat().st_size,"sha256":digest(p),"expected_sha256":expected,"verified":True,"role":"build-tool-only" if name=="cmake" else "runtime-source"})
for name,version,url,tag,commit in [
 ("aom","3.15.3","https://aomedia.googlesource.com/aom.git","v3.15.3","b141d9c45db236335351c8a4b2a14b3ade27c937"),
 ("zimg","3.0.6","https://github.com/sekrit-twc/zimg.git","release-3.0.6","df9c1472b9541d0e79c8d02dae37fdf12f189ec2"),
 ("graphengine","git-f06d7cb","https://github.com/sekrit-twc/graphengine.git",None,"f06d7cb4d589ea4657f01b13613efb7437c8ecda")]:
 gitdir=S/(name+"-git")
 if not gitdir.exists():
  args=["git","clone","--depth","1","--single-branch"]
  if tag:args.extend(["--branch",tag])
  subprocess.run([*args,url,str(gitdir)],check=True)
 actual=subprocess.check_output(["git","-C",str(gitdir),"rev-parse","HEAD"],text=True).strip()
 if actual!=commit:
  subprocess.run(["git","-C",str(gitdir),"fetch","--depth","1","origin",commit],check=True)
  subprocess.run(["git","-C",str(gitdir),"checkout","--detach",commit],check=True)
 assert subprocess.check_output(["git","-C",str(gitdir),"rev-parse","HEAD"],text=True).strip()==commit
 subprocess.run(["git","-C",str(gitdir),"fsck","--full"],check=True)
 p=S/(name+"-"+commit+".tar.gz")
 if not p.exists():
  with p.open("xb") as f:
   with gzip.GzipFile(fileobj=f,mode="wb",filename="",mtime=0) as g:
    proc=subprocess.Popen(["git","-C",str(gitdir),"archive","--format=tar","--prefix="+name+"-"+commit+"/",commit],stdout=subprocess.PIPE)
    shutil.copyfileobj(proc.stdout,g);assert proc.wait()==0
 extract(p,S)
 save({"name":name,"version":version,"url":url,"tag":tag,"git_commit":commit,"git_tree":subprocess.check_output(["git","-C",str(gitdir),"rev-parse","HEAD^{tree}"],text=True).strip(),"git_object_integrity":"git fsck --full passed; exact pinned HEAD","archive":p.name,"bytes":p.stat().st_size,"sha256":digest(p),"archive_creation":"Deterministic git archive of pinned commit, gzip mtime0","verified":True,"role":"runtime-source"})
tool=TOOLS/"cmake-4.4.5-macos-universal.tar.gz";url="https://github.com/Kitware/CMake/releases/download/v4.4.5/cmake-4.4.5-macos-universal.tar.gz";expected="679e77a96b9ef9484cc6c1445255fc4f84206b48a65420efbedf16bdab55fbff"
fetch(url,tool,expected);assert tool.stat().st_size==89451542;extract(tool,TOOLS)
data={"schema_version":1,"cmake":{"version":"4.4.5","role":"build-tool-only-never-shipped","url":url,"bytes":tool.stat().st_size,"sha256":digest(tool),"matching_source_archive":"cmake-4.4.5.tar.gz","source_sha256":"a0c54c88abb8078dd8eccadb717fc6bb194bf18e7d44c86309910288886e04e2"}}
(E/"build-tools.json").write_text(json.dumps(data,indent=2)+"\n");print("PRO_SOURCES_AND_CMAKE_READY",flush=True)
