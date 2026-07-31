import math
import wave
import os
import struct

output_path = '/Users/manuelchavez/Documents/FinOpsProyect/.tmp/bg_music.wav'
os.makedirs(os.path.dirname(output_path), exist_ok=True)

sample_rate = 44100
duration = 48.0  # 48 segundos de música moderna
num_samples = int(sample_rate * duration)

# Tempo: 120 BPM -> 1 beat = 0.5s
# Acordes (Hz): Cmaj7 -> Am7 -> Fmaj7 -> G7
chords = [
    [261.63, 329.63, 392.00, 493.88],  # Cmaj7 (C4, E4, G4, B4)
    [220.00, 261.63, 329.63, 392.00],  # Am7 (A3, C4, E4, G4)
    [174.61, 220.00, 261.63, 329.63],  # Fmaj7 (F3, A3, C4, E4)
    [196.00, 246.94, 293.66, 349.23],  # G7 (G3, B3, D4, F4)
]

bass_notes = [130.81, 110.00, 87.31, 98.00]  # C3, A2, F2, G2

print("Generating upbeat electronic corporate background music...")

with wave.open(output_path, 'w') as wav_file:
    wav_file.setnchannels(2)  # Stereo
    wav_file.setsampwidth(2)  # 16-bit
    wav_file.setframerate(sample_rate)

    frames = bytearray()
    
    for i in range(num_samples):
        t = i / sample_rate
        beat = (t * 2.0) % 4.0  # 0 to 4 beats per measure
        measure = int(t / 2.0) % len(chords)
        
        current_chord = chords[measure]
        current_bass = bass_notes[measure]
        
        # 1. Soft Pad Synthesizer (Chords)
        pad_val = 0.0
        for freq in current_chord:
            pad_val += math.sin(2 * math.pi * freq * t) * 0.08
        
        # 2. Rhythmic Bassline (Pulse every quarter beat)
        bass_env = math.exp(-12 * (t % 0.5))  # Pluck envelope
        bass_val = math.sin(2 * math.pi * current_bass * t) * bass_env * 0.25
        
        # 3. Arpeggio Synth (Upbeat High Pitch Pulse)
        arp_index = int((t * 8) % len(current_chord))
        arp_freq = current_chord[arp_index] * 2.0  # Octave up
        arp_env = math.exp(-20 * (t % 0.125))
        arp_val = (math.sin(2 * math.pi * arp_freq * t) + 0.3 * math.sin(4 * math.pi * arp_freq * t)) * arp_env * 0.12
        
        # 4. Subtle Hi-Hat / Percussion Tick (noise)
        hihat_tick = math.exp(-60 * (t % 0.25)) * (math.sin(t * 10000) * 0.03)
        
        # Combine channels
        mix_left = pad_val + bass_val + arp_val * 0.7 + hihat_tick
        mix_right = pad_val + bass_val + arp_val * 1.3 + hihat_tick
        
        # Fade in & Fade out
        if t < 2.0:
            fade = t / 2.0
            mix_left *= fade
            mix_right *= fade
        elif t > duration - 3.0:
            fade = (duration - t) / 3.0
            mix_left *= max(0, fade)
            mix_right *= max(0, fade)
            
        # Clipping prevention (scale to int16 range)
        l_int = int(max(-32767, min(32767, mix_left * 16000)))
        r_int = int(max(-32767, min(32767, mix_right * 16000)))
        
        frames.extend(struct.pack('<hh', l_int, r_int))
        
    wav_file.writeframes(frames)

print(f"✅ Created synthetic upbeat music track: {output_path}")
