// Zone labels for zone classifier
// Corresponds to ZoneClassifier::predict() output indices

#pragma once

const char* kZoneLabels[] = {
    "Dry Zone",           // 0
    "Intermediate Zone",  // 1
    "Upcountry",          // 2
    "Wet Zone"            // 3
};

const int NUM_ZONES = 4;

// Zone characteristics
// Dry Zone: Northern and eastern lowlands (Anuradhapura, Matara)
// Intermediate Zone: Central region at moderate elevation (Kandy, Nuwara Eliya surroundings)
// Upcountry: Central highlands (Nuwara Eliya, Kandy highlands)
// Wet Zone: Southwestern and western lowlands (Colombo, Galle)
