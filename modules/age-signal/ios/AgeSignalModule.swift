// Apple's age range signal (DeclaredAgeRange, iOS 26) + the App Store country.
// Adapted from Expo's expo-age-range (MIT): its SDK 54 version can only ask
// for the age range; this adds Apple's own "is age assurance required for
// this person?" check (iOS 26.2+) so the system sheet is only shown where a
// law requires it (lib/ageSignal.ts decides when to ask).

import ExpoModulesCore
import DeclaredAgeRange
import StoreKit

internal struct AgeSignalResult: Record {
  // "sharing" | "declined" | "unavailable" | "unsupported"
  @Field var status: String = "unsupported"
  @Field var lowerBound: Int?
  @Field var upperBound: Int?
}

public class AgeSignalModule: Module {
  @available(iOS 26.0, *)
  @MainActor
  private static func askApple(threshold: Int, appContext: AppContext?) async -> (status: String, lowerBound: Int?, upperBound: Int?) {
    guard let currentVc = appContext?.utilities?.currentViewController() else {
      return ("unavailable", nil, nil)
    }
    do {
      let response = try await AgeRangeService.shared.requestAgeRange(ageGates: threshold, in: currentVc)
      switch response {
      case .sharing(let range):
        return ("sharing", range.lowerBound, range.upperBound)
      case .declinedSharing:
        return ("declined", nil, nil)
      @unknown default:
        return ("unavailable", nil, nil)
      }
    } catch {
      // Not signed in to an Apple Account, invalid request, etc.
      return ("unavailable", nil, nil)
    }
  }

  public func definition() -> ModuleDefinition {
    Name("AgeSignal")

    // Shows Apple's sheet (or answers silently, per the person's settings).
    // Only the age range is returned, never a birthday.
    AsyncFunction("requestAgeRangeAsync") { (threshold: Int) async -> AgeSignalResult in
      var result = AgeSignalResult()
      guard #available(iOS 26.0, *) else {
        return result
      }
      // The whole UI part runs on the main actor; only plain values come back.
      let answer = await Self.askApple(threshold: threshold, appContext: appContext)
      result.status = answer.status
      result.lowerBound = answer.lowerBound
      result.upperBound = answer.upperBound
      return result
    }

    // true / false = Apple says age assurance is / isn't required for this
    // person (e.g. their region's law). nil = can't tell: iOS before 26.2, or
    // a build made with an SDK older than iOS 26.2 (compiler guard below).
    AsyncFunction("isEligibleForAgeFeaturesAsync") { () async -> Bool? in
      #if compiler(>=6.2.3) // Xcode 26.2+ ships the iOS 26.2 SDK that defines it.
      if #available(iOS 26.2, *) {
        return try? await AgeRangeService.shared.isEligibleForAgeFeatures
      }
      #endif
      return nil
    }

    // The App Store storefront country (ISO 3166-1 alpha-3, e.g. "USA",
    // "CAN"), or nil if unknown.
    AsyncFunction("getStorefrontCountryAsync") { () async -> String? in
      return await Storefront.current?.countryCode
    }
  }
}
