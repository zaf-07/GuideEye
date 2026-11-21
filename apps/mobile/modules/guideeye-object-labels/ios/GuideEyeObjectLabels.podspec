Pod::Spec.new do |s|
  s.name = 'GuideEyeObjectLabels'
  s.version = '1.0.0'
  s.summary = 'On-device object classification for GuideEye'
  s.author = ''
  s.homepage = 'https://docs.expo.dev/modules/'
  s.platform = :ios, '16.4'
  s.source = { git: '' }
  s.source_files = '*.swift'
  s.frameworks = 'Vision', 'ImageIO'
  s.dependency 'ExpoModulesCore'
  s.static_framework = true
end
