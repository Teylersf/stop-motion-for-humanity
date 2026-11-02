#!/usr/bin/env python3
"""Build pinned, unmodified zimg generic C++ sources without global autotools.

Creates a private CMake wrapper from the unconditional Makefile.am source list.
Graphengine is mapped to its separately verified gitlink source tree. No SIMD,
examples, test framework, source downloads, or source-tree edits are involved.
"""
import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ZIMG_COMMIT = 'df9c1472b9541d0e79c8d02dae37fdf12f189ec2'
GRAPH_COMMIT = 'f06d7cb4d589ea4657f01b13613efb7437c8ecda'


def utc():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(data)
    return result.hexdigest()


def fingerprint(root):
    files = []
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            # Upstream includes documentation links. Inventory the link itself;
            # do not follow it or replace any upstream filesystem entry.
            files.append({'path':path.relative_to(root).as_posix(),'symlink':os.readlink(path)})
            continue
        if path.is_file():
            files.append({'path': path.relative_to(root).as_posix(), 'bytes': path.stat().st_size, 'sha256': sha(path)})
    if not files:
        raise ValueError('Empty source tree: ' + str(root))
    encoded = json.dumps(files, sort_keys=True, separators=(',', ':')).encode()
    return {'file_count':sum('sha256' in item for item in files),'symlink_count':sum('symlink' in item for item in files),'inventory_sha256': hashlib.sha256(encoded).hexdigest(), 'files': files}


def make_sources(makefile, zimg, graph):
    text = makefile.read_text()
    # The first '=' assignment is the generic upstream library. Conditional
    # '+=' lists for ARM/x86 SIMD are deliberately excluded, matching --disable-simd.
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines) if re.match(r'^libzimg_internal_la_SOURCES\s*=', line)), None)
    if start is None:
        raise ValueError('Cannot find unconditional upstream library source list')
    pieces = []
    line = lines[start].split('=', 1)[1].strip()
    while True:
        continued = line.endswith('\\')
        pieces.append(line[:-1] if continued else line)
        if not continued:
            break
        start += 1
        line = lines[start].strip()
    names = ' '.join(pieces).split()
    cpp_names = ['dummy.cpp'] + [name for name in names if name.endswith('.cpp')]
    if len(cpp_names) < 20 or len(cpp_names) != len(set(cpp_names)):
        raise ValueError('Unexpected or duplicated upstream source list')
    result = []
    for name in cpp_names:
        if name.startswith('graphengine/'):
            path = graph / name[len('graphengine/'):]
        else:
            path = zimg / name
        if '..' in Path(name).parts or not path.is_file():
            raise ValueError('Missing/unsafe upstream source: ' + name)
        result.append({'upstream_path': name, 'build_path': str(path), 'sha256': sha(path)})
    return result


SMOKE = r'''#include <zimg.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <vector>

static int failure(const char *where) {
    char message[1024] = {};
    int code = zimg_get_last_error(message, sizeof message);
    std::fprintf(stderr, "%s: %d %s\n", where, code, message);
    return 1;
}
int main() {
    unsigned major=0, minor=0, micro=0;
    zimg_get_version_info(&major, &minor, &micro);
    if (major!=3 || minor!=0 || micro!=6) return 2;
    constexpr unsigned width=32, height=16;
    constexpr size_t samples=width*height;
    zimg_image_format input, output;
    zimg_image_format_default(&input, ZIMG_API_VERSION);
    input.width=width; input.height=height; input.pixel_type=ZIMG_PIXEL_FLOAT;
    input.subsample_w=0; input.subsample_h=0; input.depth=32;
    input.color_family=ZIMG_COLOR_RGB; input.matrix_coefficients=ZIMG_MATRIX_RGB;
    input.transfer_characteristics=ZIMG_TRANSFER_IEC_61966_2_1;
    input.color_primaries=ZIMG_PRIMARIES_BT709; input.pixel_range=ZIMG_RANGE_FULL;
    output=input; output.transfer_characteristics=ZIMG_TRANSFER_LINEAR;
    zimg_graph_builder_params params;
    zimg_graph_builder_params_default(&params, ZIMG_API_VERSION);
    params.cpu_type=ZIMG_CPU_NONE;
    std::unique_ptr<zimg_filter_graph, decltype(&zimg_filter_graph_free)> graph(zimg_filter_graph_build(&input,&output,&params),zimg_filter_graph_free);
    if (!graph) return failure("build");
    size_t tmp_size=0;
    if (zimg_filter_graph_get_tmp_size(graph.get(), &tmp_size)) return failure("temporary size");
    std::unique_ptr<void, decltype(&std::free)> tmp(std::aligned_alloc(64, ((std::max(tmp_size,size_t(1))+63)/64)*64),std::free);
    if (!tmp) return 3;
    zimg_image_buffer_const src={}; zimg_image_buffer dst={};
    src.version=ZIMG_API_VERSION; dst.version=ZIMG_API_VERSION;
    std::vector<std::unique_ptr<void, decltype(&std::free)>> memory;
    for(unsigned p=0;p<3;++p) {
        memory.emplace_back(std::aligned_alloc(64,samples*sizeof(float)),std::free);
        memory.emplace_back(std::aligned_alloc(64,samples*sizeof(float)),std::free);
        if(!memory[memory.size()-2] || !memory.back())return 4;
        auto in=static_cast<float*>(memory[memory.size()-2].get());
        auto out=static_cast<float*>(memory.back().get());
        for(size_t i=0;i<samples;++i) { in[i]=static_cast<float>(i%width)/(width-1); out[i]=-123.0f; }
        src.plane[p]={in,width*sizeof(float),ZIMG_BUFFER_MAX};
        dst.plane[p]={out,width*sizeof(float),ZIMG_BUFFER_MAX};
    }
    if(zimg_filter_graph_process(graph.get(),&src,&dst,tmp.get(),nullptr,nullptr,nullptr,nullptr))return failure("process");
    double max_error=0;
    for(unsigned p=0;p<3;++p)for(size_t i=0;i<samples;++i) {
        double v=static_cast<const float*>(src.plane[p].data)[i];
        double expected=v<=0.04045?v/12.92:std::pow((v+0.055)/1.055,2.4);
        double actual=static_cast<float*>(dst.plane[p].data)[i];
        if(!std::isfinite(actual))return 5;
        max_error=std::max(max_error,std::abs(actual-expected));
    }
    if(max_error>0.00001)return 6;
    std::printf("{\"version\":\"%u.%u.%u\",\"width\":%u,\"height\":%u,\"planes\":3,\"conversion\":\"sRGB_to_linear_float\",\"max_absolute_error\":%.12g}\n",major,minor,micro,width,height,max_error);
    return 0;
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--jobs', type=int, default=3)
    args = parser.parse_args()
    if not 1 <= args.jobs <= 3:
        parser.error('--jobs must be 1..3')
    root = args.work_root.absolute()
    zimg = root / ('sources/zimg-' + ZIMG_COMMIT)
    graph = root / ('sources/graphengine-' + GRAPH_COMMIT)
    build = root / 'build/zimg'
    prefix = root / 'prefix'
    evidence = root / 'evidence/zimg-build-commands.json'
    cmake = root / 'tools/cmake-4.4.5-macos-universal/CMake.app/Contents/bin/cmake'
    outputs = [prefix/'lib/libzimg.a', prefix/'include/zimg.h', prefix/'include/zimg++.hpp', prefix/'lib/pkgconfig/zimg.pc']
    for path in [build, evidence, *outputs]:
        if path.exists() or path.is_symlink():
            parser.error('Refusing to replace existing owned output: ' + str(path))
    if not cmake.is_file() or not zimg.is_dir() or not graph.is_dir():
        parser.error('Pinned source tree/private CMake is missing')
    source_inputs = root / 'evidence/source-inputs.json'
    entries = json.loads(source_inputs.read_text())['sources']
    selected = [next(e for e in entries if e['name'] == name) for name in ['zimg','graphengine']]
    for item, commit in zip(selected, [ZIMG_COMMIT, GRAPH_COMMIT]):
        if item.get('git_commit') != commit or item.get('verified') is not True:
            raise ValueError('Source provenance does not match pin')
        archive = root / 'sources' / item['archive']
        if not archive.is_file() or sha(archive) != item['sha256']:
            raise ValueError('Source archive hash mismatch: ' + str(archive))
    build.mkdir(parents=True)
    wrapper = build / 'wrapper'
    wrapper.mkdir()
    report = {'schema_version': 1, 'status': 'running', 'started_utc': utc(), 'scope': 'Static generic upstream zimg library only; no upstream modifications and no runtime-payload audit.', 'upstream_configuration_equivalent': '--disable-simd --disable-shared --enable-static, no examples/testapp/unit tests', 'sources': selected, 'source_inputs_sha256': sha(source_inputs), 'recipe_sha256': sha(Path(__file__).resolve()), 'cmake': {'path':str(cmake),'sha256':sha(cmake)}, 'commands': [], 'source_fingerprints_before': {'zimg':fingerprint(zimg),'graphengine':fingerprint(graph)}}
    started = time.monotonic()

    def save():
        tmp = evidence.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(report,indent=2)+'\n')
        os.replace(tmp,evidence)

    def run(name, argv, env, timeout):
        log = root / ('evidence/zimg-' + name + '.log')
        if log.exists():
            raise ValueError('Refusing to overwrite existing log: ' + str(log))
        item = {'name':name,'argv':[str(a) for a in argv],'cwd':str(build),'environment':env,'log':str(log),'started_utc':utc(),'timeout_seconds':timeout,'status':'running'}
        report['commands'].append(item)
        save()
        command_started = time.monotonic()
        child = None
        try:
            with log.open('xb') as output:
                child = subprocess.Popen(item['argv'],cwd=build,env=env,stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
                item['pid']=child.pid
                save()
                code=child.wait(timeout=timeout)
            item.update(returncode=code,status='passed' if code==0 else 'failed')
            if code:
                raise RuntimeError('%s failed; see %s' % (name,log))
        except BaseException:
            if child is not None and child.poll() is None:
                os.killpg(child.pid,signal.SIGTERM)
                try:child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid,signal.SIGKILL)
                    child.wait(timeout=5)
            item['status']='failed'
            raise
        finally:
            item['elapsed_seconds']=round(time.monotonic()-command_started,6)
            if log.exists():item['log_sha256']=sha(log)
            save()
        return log.read_text()

    def terminate(signum, frame):
        raise KeyboardInterrupt('received signal %d' % signum)

    signal.signal(signal.SIGTERM,terminate)
    env={'PATH':str(prefix/'bin')+':/usr/bin:/bin:/usr/sbin:/sbin','MACOSX_DEPLOYMENT_TARGET':'14.0','LC_ALL':'C','LANG':'C','TMPDIR':os.environ.get('TMPDIR','/tmp')}
    try:
        save()
        sdk=run('sdk-path',['/usr/bin/xcrun','--sdk','macosx','--show-sdk-path'],env,30).strip()
        if not Path(sdk).is_dir():raise ValueError('SDK path is unavailable')
        env=dict(env,SDKROOT=sdk)
        run('cmake-version',[cmake,'--version'],env,30)
        sources=make_sources(zimg/'Makefile.am',zimg,graph)
        report['compiled_sources']=sources
        cpp='\n'.join('  "'+s['build_path']+'"' for s in sources)
        cmake_text='''cmake_minimum_required(VERSION 3.20)
project(zimg_private VERSION 3.0.6 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
add_library(zimg STATIC
'''+cpp+'''
)
set_target_properties(zimg PROPERTIES POSITION_INDEPENDENT_CODE ON CXX_VISIBILITY_PRESET hidden VISIBILITY_INLINES_HIDDEN ON)
target_compile_definitions(zimg PRIVATE GRAPHENGINE_IMPL_NAMESPACE=zimg)
target_include_directories(zimg PRIVATE "'''+str(zimg/'src/zimg')+'" "'+str(graph/'include')+'''")
target_compile_options(zimg PRIVATE -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers -fno-fast-math)
find_package(Threads REQUIRED)
target_link_libraries(zimg PRIVATE Threads::Threads)
install(TARGETS zimg ARCHIVE DESTINATION lib)
install(FILES "'''+str(zimg/'src/zimg/api/zimg.h')+'" "'+str(zimg/'src/zimg/api/zimg++.hpp')+'''" DESTINATION include)
configure_file("${CMAKE_CURRENT_SOURCE_DIR}/zimg.pc.in" "${CMAKE_CURRENT_BINARY_DIR}/zimg.pc" @ONLY)
install(FILES "${CMAKE_CURRENT_BINARY_DIR}/zimg.pc" DESTINATION lib/pkgconfig)
'''
        (wrapper/'CMakeLists.txt').write_text(cmake_text)
        (wrapper/'zimg.pc.in').write_text('prefix=@CMAKE_INSTALL_PREFIX@\nexec_prefix=${prefix}\nlibdir=${prefix}/lib\nincludedir=${prefix}/include\n\nName: zimg\nDescription: Scaling, colorspace conversion, and dithering library\nVersion: 3.0.6\nLibs: -L${libdir} -lzimg\nLibs.private: -lc++\nCflags: -I${includedir}\n')
        report['generated_wrapper']={'CMakeLists.txt_sha256':sha(wrapper/'CMakeLists.txt'),'zimg.pc.in_sha256':sha(wrapper/'zimg.pc.in')}
        run('configure',[cmake,'-S',wrapper,'-B',build/'cmake','-G','Unix Makefiles','-DCMAKE_MAKE_PROGRAM=/usr/bin/make','-DCMAKE_CXX_COMPILER=/usr/bin/clang++','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_CXX_FLAGS_RELEASE=-O2 -DNDEBUG','-DCMAKE_OSX_ARCHITECTURES=arm64','-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0','-DCMAKE_OSX_SYSROOT='+sdk,'-DCMAKE_INSTALL_PREFIX='+str(prefix),'-DCMAKE_EXPORT_COMPILE_COMMANDS=ON'],env,120)
        run('make',[cmake,'--build',build/'cmake','--parallel',str(args.jobs)],env,1200)
        run('install',[cmake,'--install',build/'cmake'],env,120)
        report['installed']=[{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in outputs]
        smoke=build/'smoke.cpp'
        smoke.write_text(SMOKE)
        report['smoke_source_sha256']=sha(smoke)
        run('smoke-compile',['/usr/bin/clang++','-std=c++17','-O2','-arch','arm64','-mmacosx-version-min=14.0','-isysroot',sdk,'-I'+str(prefix/'include'),smoke,prefix/'lib/libzimg.a','-lc++','-o',build/'zimg-smoke'],env,60)
        report['smoke_result']=json.loads(run('smoke-run',[build/'zimg-smoke'],env,30))
        pkg_env=dict(env,PKG_CONFIG_LIBDIR=str(prefix/'lib/pkgconfig'),PKG_CONFIG_PATH='')
        pkg_flags=run('pkgconf-static',[prefix/'bin/pkgconf','--static','--cflags','--libs','zimg'],pkg_env,30).strip()
        import shlex
        c_smoke=build/'smoke.c'
        c_smoke.write_text('#include <zimg.h>\nint main(void) { zimg_image_format f; zimg_image_format_default(&f, ZIMG_API_VERSION); return f.matrix_coefficients == ZIMG_MATRIX_UNSPECIFIED && zimg_get_api_version(0,0) >= ZIMG_MAKE_API_VERSION(2,4) ? 0 : 1; }\n')
        run('c-pkgconf-link',['/usr/bin/clang','-std=c99','-arch','arm64','-mmacosx-version-min=14.0','-isysroot',sdk,c_smoke,*shlex.split(pkg_flags),'-o',build/'zimg-c-smoke'],pkg_env,60)
        run('c-pkgconf-run',[build/'zimg-c-smoke'],pkg_env,30)
        report['c_pkgconf_static_link_verified']=True
        report['source_fingerprints_after']={'zimg':fingerprint(zimg),'graphengine':fingerprint(graph)}
        report['source_trees_unchanged']=report['source_fingerprints_before']==report['source_fingerprints_after']
        if not report['source_trees_unchanged']:raise ValueError('Upstream source tree changed during build')
        report['status']='passed'
    except BaseException as exc:
        report.update(status='failed',error=repr(exc))
        raise
    finally:
        report['finished_utc']=utc()
        report['elapsed_seconds']=round(time.monotonic()-started,6)
        save()
        print(json.dumps({'status':report['status'],'output':str(evidence),'elapsed_seconds':report['elapsed_seconds'],'error':report.get('error')}),flush=True)
    return 0


if __name__=='__main__':
    sys.exit(main())
