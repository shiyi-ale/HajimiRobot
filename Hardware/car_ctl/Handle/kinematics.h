#ifndef __KINEMATICS_H
#define __KINEMATICS_H

#include "main.h"

void Kinematics_Init(float wheel_radius, float robot_radius);
void Kinematics_Inverse(float vx, float vy, float omega, int16_t out_speeds[4]);

#endif


