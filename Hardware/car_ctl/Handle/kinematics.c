#include "kinematics.h"

static float wheel_r = 0.03f;   // 轮子半径 (m)
static float robot_r = 0.15f;   // 机器人中心到轮子距离 (Lx+Ly) (m)

void Kinematics_Init(float wheel_radius, float robot_radius)
{
    wheel_r = wheel_radius;
    robot_r = robot_radius;
}

// 麦克纳姆轮逆运动学 (X型布局)
void Kinematics_Inverse(float vx, float vy, float omega, int16_t out_speeds[4])
{
    float fl = ( vx - vy - omega * robot_r ) / wheel_r;
    float fr = ( vx + vy + omega * robot_r ) / wheel_r;
    float rl = ( vx + vy - omega * robot_r ) / wheel_r;
    float rr = ( vx - vy + omega * robot_r ) / wheel_r;
    
    // 最大线速度 1.5 m/s，映射到 [-1000, 1000]
    float max_speed = 1.5f;
    out_speeds[0] = (int16_t)((fl / max_speed) * 1000.0f);
    out_speeds[1] = (int16_t)((fr / max_speed) * 1000.0f);
    out_speeds[2] = (int16_t)((rl / max_speed) * 1000.0f);
    out_speeds[3] = (int16_t)((rr / max_speed) * 1000.0f);
    
    for (int i = 0; i < 4; i++) {
        if (out_speeds[i] > 1000) out_speeds[i] = 1000;
        if (out_speeds[i] < -1000) out_speeds[i] = -1000;
    }
}