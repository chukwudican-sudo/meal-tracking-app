Pod::Spec.new do |s|
  s.name           = 'AgeSignal'
  s.version        = '1.0.0'
  s.summary        = "Apple's age range signal (Declared Age Range) and the App Store country"
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'Macrotri'
  s.homepage       = 'https://macrotri.com'
  s.platforms      = { :ios => '15.1' }
  # Swift 5 language mode, like ExpoModulesCore and the other SDK 54 Expo modules.
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,swift}"
end
