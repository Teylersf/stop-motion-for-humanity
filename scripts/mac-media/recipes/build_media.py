#!/usr/bin/env python3
"""Build the pinned lean ARM64 media tools; Python is a build driver, never shipped."""
from pathlib import Path
from datetime import datetime, timezone
import os, subprocess, json, time, shutil, hashlib, sys
ROOT=Path(__file__).resolve().parents[1]
ALIAS=Path("/tmp/smfh-native-media14-20261102")
if ALIAS.is_symlink() and ALIAS.resolve()==ROOT:
 WORK=ALIAS
else:
 WORK=ROOT
S=WORK/"sources"; B=WORK/"build"; P=WORK/"prefix"; E=WORK/"evidence"; STAGE=WORK/"stage"/"darwin-arm64"
TARGET="14.0"; JOBS="4"; records=[]
ONLY_FFMPEG="--only-ffmpeg" in sys.argv
if ONLY_FFMPEG:
 records=[r for r in json.loads((E/"build-commands.json").read_text())["commands"] if not r["name"].startswith(("ffmpeg-","stage-"))]
for d in [B,P,E,STAGE]:d.mkdir(parents=True,exist_ok=True)
sdk=subprocess.check_output(["xcrun","--sdk","macosx","--show-sdk-path"],text=True).strip()
env=os.environ.copy()
for key in ["CPATH","LIBRARY_PATH","C_INCLUDE_PATH","CPLUS_INCLUDE_PATH","DYLD_LIBRARY_PATH","DYLD_FALLBACK_LIBRARY_PATH","PKG_CONFIG_PATH","PKG_CONFIG_LIBDIR"]:
 env.pop(key,None)
common="-O2 -arch arm64 -mmacosx-version-min="+TARGET+" -isysroot "+sdk+" -ffile-prefix-map="+str(ROOT)+"=."
env.update({"PATH":str(P/"bin")+":/usr/bin:/bin:/usr/sbin:/sbin","CC":"/usr/bin/clang","CXX":"/usr/bin/clang++","AR":"/usr/bin/ar","RANLIB":"/usr/bin/ranlib","STRIP":"/usr/bin/strip","MACOSX_DEPLOYMENT_TARGET":TARGET,"SDKROOT":sdk,"CFLAGS":common,"CXXFLAGS":common,"LDFLAGS":"-arch arm64 -mmacosx-version-min="+TARGET+" -isysroot "+sdk,"PKG_CONFIG_LIBDIR":str(P/"lib/pkgconfig"),"PKG_CONFIG_PATH":str(P/"lib/pkgconfig")})
def save():
 (E/"build-commands.json").write_text(json.dumps({"schema_version":1,"target_macos":TARGET,"architecture":"arm64","compiler":subprocess.check_output(["/usr/bin/clang","--version"],text=True).splitlines()[0],"sdk":sdk,"environment":{k:env[k] for k in ["CC","CXX","AR","RANLIB","STRIP","MACOSX_DEPLOYMENT_TARGET","SDKROOT","CFLAGS","CXXFLAGS","LDFLAGS","PKG_CONFIG_LIBDIR","PKG_CONFIG_PATH"]},"commands":records},indent=2)+"\n")
def run(name,args,cwd):
 start=time.monotonic(); rec={"name":name,"argv":[str(a) for a in args],"cwd":str(cwd),"started_utc":datetime.now(timezone.utc).isoformat()}
 print("START "+name,flush=True)
 with (E/(name+".log")).open("wb") as log:r=subprocess.run([str(a) for a in args],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT)
 rec.update({"exit_code":r.returncode,"seconds":round(time.monotonic()-start,3)});records.append(rec);save()
 print("END "+name+" exit="+str(r.returncode)+" seconds="+str(rec["seconds"]),flush=True)
 if r.returncode:raise SystemExit("Inspect "+str(E/(name+".log")))
def build(name,src,flags):
 cwd=B/name;cwd.mkdir(exist_ok=True)
 run(name+"-configure",[src/"configure",*flags],cwd)
 run(name+"-make",["/usr/bin/make","-j"+JOBS],cwd)
 run(name+"-install",["/usr/bin/make","install"],cwd)
prefix="--prefix="+str(P)
if not ONLY_FFMPEG:
 build("pkgconf",S/"pkgconf-3.0.10",[prefix,"--disable-shared","--enable-static","--disable-dependency-tracking","--with-pkg-config-dir="+str(P/"lib/pkgconfig"),"--with-system-libdir=/usr/lib","--with-system-includedir="+sdk+"/usr/include"])
link=P/"bin/pkg-config"
if not link.exists():link.symlink_to("pkgconf")
if not ONLY_FFMPEG:
 build("x264",S/"x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55",[prefix,"--enable-static","--disable-shared","--disable-cli","--enable-pic","--disable-opencl","--disable-swscale","--disable-ffms","--disable-lsmash","--bit-depth=all","--host=aarch64-apple-darwin","--extra-cflags="+common,"--extra-ldflags="+env["LDFLAGS"]])
 build("opus",S/"opus-1.6.1",[prefix,"--disable-shared","--enable-static","--with-pic","--disable-doc","--disable-extra-programs","--disable-deep-plc","--disable-dred"])
 build("libvpx",S/"libvpx-1.17.0",[prefix,"--target=arm64-darwin23-gcc","--disable-shared","--enable-static","--enable-pic","--enable-runtime-cpu-detect","--enable-vp9-highbitdepth","--disable-examples","--disable-tools","--disable-docs","--disable-unit-tests","--extra-cflags="+common])
if not ONLY_FFMPEG:
 run("pro-codecs-helper",[sys.executable,ROOT/"recipes/build_pro_codecs.py"],ROOT)
 run("zimg-helper",[sys.executable,ROOT/"recipes/build_zimg.py"],ROOT)
# Enable every built-in native codec, parser and file container. External
# libraries remain opt-in, and only file/pipe protocols are compiled.
flags=[prefix,"--target-os=darwin","--arch=arm64","--cc=/usr/bin/clang","--cxx=/usr/bin/clang++","--ar=/usr/bin/ar","--ranlib=/usr/bin/ranlib","--nm=/usr/bin/nm","--strip=/usr/bin/strip","--extra-version=smfh-macos14-pro-v1","--disable-autodetect","--disable-network","--disable-shared","--enable-static","--enable-gpl","--enable-version3","--disable-doc","--disable-debug","--disable-ffplay","--enable-ffmpeg","--enable-ffprobe","--disable-indevs","--disable-outdevs","--enable-indev=lavfi","--disable-protocols","--enable-protocol=file,pipe","--enable-libx264","--enable-libx265","--enable-libaom","--enable-libvpx","--enable-libopus","--enable-libzimg","--enable-zlib","--enable-videotoolbox","--enable-audiotoolbox","--pkg-config="+str(P/"bin/pkg-config"),"--pkg-config-flags=--static","--extra-cflags="+common+" -I"+str(P/"include"),"--extra-ldflags="+env["LDFLAGS"]+" -L"+str(P/"lib"),"--optflags=-O2"]
build("ffmpeg",S/"ffmpeg-9.0.2",flags)
for name in ["ffmpeg","ffprobe"]:
 out=STAGE/name;shutil.copy2(P/"bin"/name,out)
 run("stage-"+name+"-strip",["/usr/bin/strip","-S","-x",out],STAGE)
 run("stage-"+name+"-sign",["/usr/bin/codesign","--force","--sign","-",out],STAGE)
 run("stage-"+name+"-verify",["/usr/bin/codesign","--verify","--strict",out],STAGE)
 print(json.dumps({"binary":str(out),"bytes":out.stat().st_size,"sha256":hashlib.sha256(out.read_bytes()).hexdigest()}),flush=True)
print("BUILD_COMPLETE",flush=True)
