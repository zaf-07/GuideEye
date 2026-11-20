import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const gradleFile = join(
  scriptDirectory,
  '..',
  '..',
  '..',
  'node_modules',
  'onnxruntime-react-native',
  'android',
  'build.gradle',
);
const iosFile = join(
  scriptDirectory,
  '..',
  '..',
  '..',
  'node_modules',
  'onnxruntime-react-native',
  'ios',
  'OnnxruntimeModule.mm',
);

const incompatibleCheck =
  'if (VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")) {';
const compatibleCheck =
  'if (false) { // GuideEye uses React Native 0.71+; Gradle 9 removed VersionNumber.';

const source = await readFile(gradleFile, 'utf8');
const occurrences = source.split(incompatibleCheck).length - 1;

if (occurrences > 1 || (occurrences === 0 && !source.includes(compatibleCheck))) {
  throw new Error(
    `Could not safely patch the ONNX Runtime VersionNumber check (found ${occurrences}).`,
  );
}

if (occurrences === 1) {
  await writeFile(gradleFile, source.replace(incompatibleCheck, compatibleCheck));
}

// onnxruntime-react-native 1.24 still names RCTCxxBridge, which React Native
// 0.88 no longer exposes in its public headers. RCTBridge still provides the
// runtime selector used by the module, so keep the compatibility shim
// reproducible instead of relying on a one-off node_modules edit.
const iosSource = await readFile(iosFile, 'utf8');
const oldInstall = `    RCTCxxBridge* cxxBridge = (RCTCxxBridge*)_bridge;
    if (cxxBridge == nil) {
      return @false;
    }

    auto jsiRuntime = (facebook::jsi::Runtime*)cxxBridge.runtime;
    if (jsiRuntime == nil) {
      return @false;
    }`;
const newInstall = `    if (_bridge == nil) {
      return @false;
    }

    void *rawRuntime = nil;
    if ([_bridge respondsToSelector:@selector(runtime)]) {
      rawRuntime = [_bridge runtime];
    }
    if (rawRuntime == nil) {
      return @false;
    }

    auto jsiRuntime = (facebook::jsi::Runtime*)rawRuntime;`;
const runtimeCategory = `@interface RCTBridge (OrtJsiRuntime)
- (void *)runtime;
@end

`;

if (iosSource.includes(oldInstall)) {
  const withCategory = iosSource.replace(
    '#import <jsi/jsi.h>\n\n',
    `#import <jsi/jsi.h>\n\n${runtimeCategory}`,
  );
  await writeFile(iosFile, withCategory.replace(oldInstall, newInstall));
} else if (
  !iosSource.includes(runtimeCategory) ||
  !iosSource.includes('auto jsiRuntime = (facebook::jsi::Runtime*)rawRuntime;') ||
  !iosSource.includes('onnxruntimejsi::install(runtime, jsiInvoker)')
) {
  throw new Error('Could not safely apply the React Native 0.88 ONNX iOS compatibility patch.');
}
