// Auto-generated Zone Classifier from Decision Tree
// Predicts climate zone from longitude and latitude
// Accuracy: 80.5% on test data
// Classes: Dry Zone, Intermediate Zone, Upcountry, Wet Zone
// 
// Decision Tree Structure:
// Longitude <= 81.43
//   Latitude <= 7.46
//     Longitude <= 80.50
//       Longitude <= 80.01: Wet Zone (3)
//       Longitude > 80.01
//         Longitude <= 80.42: Wet Zone (3)
//         Longitude > 80.42: Wet Zone (3)
//     Longitude > 80.50
//       Longitude <= 81.00
//         Latitude <= 6.51: Wet Zone (3)
//         Latitude > 6.51: Upcountry (2)
//       Longitude > 81.00: Intermediate Zone (1)
//   Latitude > 7.46: Intermediate Zone (1)
// Longitude > 81.43: Dry Zone (0)

#pragma once

namespace Eloquent {
    namespace ML {
        namespace Port {
            class ZoneClassifier {
            public:
                /**
                 * Predict climate zone from coordinates
                 * @param longitude : Device longitude (79-82)
                 * @param latitude  : Device latitude (5-10)
                 * @return zone index: 0=Dry Zone, 1=Intermediate Zone, 2=Upcountry, 3=Wet Zone
                 */
                static int predict(float longitude, float latitude) {
                    // Decision Tree Implementation
                    // Node 0: Longitude <= 81.43
                    if (longitude <= 81.43f) {
                        // Node 1: Latitude <= 7.46
                        if (latitude <= 7.46f) {
                            // Node 2: Longitude <= 80.50
                            if (longitude <= 80.50f) {
                                // Node 3: Longitude <= 80.01
                                if (longitude <= 80.01f) {
                                    return 3;  // Wet Zone
                                } else {
                                    // Node 4: Longitude <= 80.42
                                    if (longitude <= 80.42f) {
                                        return 3;  // Wet Zone
                                    } else {
                                        return 3;  // Wet Zone
                                    }
                                }
                            } else {
                                // Node 5: Longitude <= 81.00
                                if (longitude <= 81.00f) {
                                    // Node 6: Latitude <= 6.51
                                    if (latitude <= 6.51f) {
                                        return 3;  // Wet Zone
                                    } else {
                                        return 2;  // Upcountry
                                    }
                                } else {
                                    // Node 7: Longitude <= 81.11
                                    if (longitude <= 81.11f) {
                                        return 1;  // Intermediate Zone
                                    } else {
                                        return 1;  // Intermediate Zone
                                    }
                                }
                            }
                        } else {
                            return 1;  // Intermediate Zone (Latitude > 7.46)
                        }
                    } else {
                        return 0;  // Dry Zone (Longitude > 81.43)
                    }
                }
                
                /**
                 * Get zone name from index
                 * @param zoneIndex : Zone index from predict()
                 * @return zone name string
                 */
                static const char* getZoneName(int zoneIndex) {
                    switch (zoneIndex) {
                        case 0:
                            return "Dry Zone";
                        case 1:
                            return "Intermediate Zone";
                        case 2:
                            return "Upcountry";
                        case 3:
                            return "Wet Zone";
                        default:
                            return "Unknown";
                    }
                }
                
                /**
                 * Get zone index from name
                 * @param zoneName : Zone name string
                 * @return zone index or -1 if not found
                 */
                static int getZoneIndex(const char* zoneName) {
                    if (strcmp(zoneName, "Dry Zone") == 0) return 0;
                    if (strcmp(zoneName, "Intermediate Zone") == 0) return 1;
                    if (strcmp(zoneName, "Upcountry") == 0) return 2;
                    if (strcmp(zoneName, "Wet Zone") == 0) return 3;
                    return -1;
                }
            };
        }
    }
}
