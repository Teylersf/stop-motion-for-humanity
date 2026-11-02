#!/usr/bin/env python3
"""Pinned static ARM64 libaom plus multilib x265; CMake is a build tool only."""
from pathlib import Path
from datetime import datetime,timezone
import os,subprocess,json,time,shutil,hashlib
ROOT=Path(__file__).resolve().parents[1]; A=Path("/tmp/smfh-native-media14-20261102")
W=A if A.is_symlink() and A.resolve()==ROOT else ROOT
S=W/"sources";B=W/"build";P=W/"prefix";E=W/"evidence"
CMAKE=W/"tools/cmake-4.4.5-macos-universal/CMake.app/Contents/bin/cmake"
assert CMAKE.is_file(),"Run prepare_pro_sources.py first"
sdk=subprocess.check_output(["xcrun","--sdk","macosx","--show-sdk-path"],text=True).strip()
env=os.environ.copy()
for k in ["CPATH","LIBRARY_PATH","C_INCLUDE_PATH","CPLUS_INCLUDE_PATH","DYLD_LIBRARY_PATH","DYLD_FALLBACK_LIBRARY_PATH","PKG_CONFIG_PATH","PKG_CONFIG_LIBDIR"]:env.pop(k,None)
env.update({"PATH":str(P/"bin")+":/usr/bin:/bin:/usr/sbin:/sbin","CC":"/usr/bin/clang","CXX":"/usr/bin/clang++","MACOSX_DEPLOYMENT_TARGET":"14.0","SDKROOT":sdk})
commands=[]
def run(name,argv,cwd=B):
 t=time.monotonic();print("START "+name,flush=True)
 with (E/(name+".log")).open("wb") as log:r=subprocess.run([str(x) for x in argv],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT)
 commands.append({"name":name,"argv":[str(x) for x in argv],"cwd":str(cwd),"exit_code":r.returncode,"seconds":round(time.monotonic()-t,3)})
 (E/"pro-codecs-build-commands.json").write_text(json.dumps({"schema_version":1,"target_macos":"14.0","architecture":"arm64","commands":commands},indent=2)+"\n")
 print("END "+name+" exit="+str(r.returncode),flush=True)
 if r.returncode:raise SystemExit("Inspect "+str(E/(name+".log")))
common=["-G","Unix Makefiles","-DCMAKE_BUILD_TYPE=Release","-DCMAKE_POLICY_VERSION_MINIMUM=3.5","-DCMAKE_OSX_ARCHITECTURES=arm64","-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0","-DCMAKE_OSX_SYSROOT="+sdk,"-DCMAKE_POSITION_INDEPENDENT_CODE=ON","-DCMAKE_INSTALL_PREFIX="+str(P),"-DCMAKE_C_COMPILER=/usr/bin/clang","-DCMAKE_CXX_COMPILER=/usr/bin/clang++","-DCMAKE_C_FLAGS=-O2 -ffile-prefix-map="+str(ROOT)+"=.","-DCMAKE_CXX_FLAGS=-O2 -ffile-prefix-map="+str(ROOT)+"=."]
def configure(name,source,flags):
 out=B/name;out.mkdir(exist_ok=True)
 run(name+"-configure",[CMAKE,"-S",source,"-B",out,*common,*flags])
 run(name+"-make",[CMAKE,"--build",out,"--parallel","4"])
 return out
aom=configure("aom",S/"aom-b141d9c45db236335351c8a4b2a14b3ade27c937",["-DBUILD_SHARED_LIBS=OFF","-DENABLE_TESTS=OFF","-DENABLE_DOCS=OFF","-DENABLE_EXAMPLES=OFF","-DENABLE_TOOLS=OFF","-DCONFIG_AV1_ENCODER=1","-DCONFIG_AV1_DECODER=1","-DCONFIG_TUNE_VMAF=0","-DAOM_TARGET_CPU=arm64"])
run("aom-install",[CMAKE,"--install",aom])
xsource=S/"x265_4.3/source";base=["-DENABLE_SHARED=OFF","-DENABLE_CLI=OFF"]
out10=configure("x265-10bit",xsource,[*base,"-DHIGH_BIT_DEPTH=ON","-DEXPORT_C_API=OFF","-DENABLE_HDR10_PLUS=ON"])
out12=configure("x265-12bit",xsource,[*base,"-DHIGH_BIT_DEPTH=ON","-DMAIN12=ON","-DEXPORT_C_API=OFF"])
out8=B/"x265-8bit";out8.mkdir(exist_ok=True)
shutil.copy2(out10/"libx265.a",out8/"libx265_main10.a");shutil.copy2(out12/"libx265.a",out8/"libx265_main12.a")
configure("x265-8bit",xsource,[*base,"-DHIGH_BIT_DEPTH=OFF","-DLINKED_10BIT=ON","-DLINKED_12BIT=ON","-DEXTRA_LINK_FLAGS=-L.","-DEXTRA_LIB=x265_main10.a;x265_main12.a"])
shutil.copy2(out8/"libx265.a",out8/"libx265_main.a")
run("x265-merge",["/usr/bin/libtool","-static","-o","libx265.a","libx265_main.a","libx265_main10.a","libx265_main12.a"],out8)
run("x265-install",[CMAKE,"--install",out8])
for name in ["libaom.a","libx265.a"]:
 p=P/"lib"/name;print(json.dumps({"static_library":name,"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()}),flush=True)
print("PRO_CODECS_BUILD_COMPLETE",flush=True)

