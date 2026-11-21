Pod::Spec.new do |s|
  s.name = 'GuideEyeHands'
  s.version = '1.0.0'
  s.summary = 'On-device hand landmark camera'
  s.author = ''
  s.homepage = 'https://docs.expo.dev/modules/'
  s.platform = :ios, '16.4'
  s.source = { git: '' }
  s.source_files = '*.swift'
  s.frameworks = 'AVFoundation', 'Vision'
  s.dependency 'ExpoModulesCore'
  s.static_framework = true
end
