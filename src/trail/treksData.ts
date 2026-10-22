import type { Trek } from './treks';

/**
 * Popular treks in Nepal, each as its main stops in walking order ([lat, lng, name]). Coordinates are
 * from OpenStreetMap via Photon (looked up 2026-10-22). A few marked "approx." were placed by hand
 * where OSM had no clear match; matching allows several kilometres of slack either way.
 */
export const TREKS: Trek[] = [
  { name: 'Everest Base Camp Trek', points: [
    [27.6873, 86.731, 'Lukla'], [27.7401, 86.7127, 'Phakding'], [27.8042, 86.7098, 'Namche Bazaar'], [27.8358, 86.7646, 'Tengboche'],
    [27.8558, 86.7902, 'Pangboche'], [27.8935, 86.8309, 'Dingboche'], [27.948, 86.81, 'Lobuche'], [27.9807, 86.8289, 'Gorak Shep'],
    [27.9997, 86.8488, 'Everest Base Camp'], [27.9958, 86.8284, 'Kala Patthar'],
  ] },
  { name: 'Gokyo Lakes Trek', points: [
    [27.6873, 86.731, 'Lukla'], [27.8042, 86.7098, 'Namche Bazaar'], [27.866, 86.728, 'Dole'], // Dole approx.
    [27.9029, 86.7156, 'Machhermo'], [27.9541, 86.6946, 'Gokyo'], [27.9615, 86.6831, 'Gokyo Ri'],
  ] },
  { name: 'Everest Three Passes Trek', points: [
    [27.8042, 86.7098, 'Namche Bazaar'], [27.8319, 86.6505, 'Thame'], [27.9056, 86.6365, 'Lungden'], [27.9474, 86.6585, 'Renjo La'],
    [27.9541, 86.6946, 'Gokyo'], [27.9617, 86.7516, 'Cho La'], [27.9399, 86.7737, 'Dzongla'], [27.948, 86.81, 'Lobuche'],
    [27.9297, 86.8362, 'Kongma La'], [27.9047, 86.8714, 'Chhukung'],
  ] },
  { name: 'Annapurna Circuit', points: [
    [28.2313, 84.3761, 'Besisahar'], [28.2903, 84.3716, 'Bhulbhule'], [28.413, 84.4065, 'Jagat'], [28.5195, 84.3586, 'Dharapani'], // Dharapani approx.
    [28.5507, 84.2424, 'Chame'], [28.607, 84.149, 'Pisang'], [28.6667, 84.0167, 'Manang'], [28.7227, 83.9738, 'Yak Kharka'],
    [28.7768, 83.9726, 'Thorong Phedi'], [28.7935, 83.9388, 'Thorong La'], [28.8167, 83.8713, 'Muktinath'], [28.7838, 83.7305, 'Jomsom'],
  ] },
  { name: 'Tilicho Lake Trek', points: [
    [28.6667, 84.0167, 'Manang'], [28.6697, 83.9734, 'Khangsar'], [28.6802, 83.9069, 'Tilicho Base Camp'], [28.6915, 83.8529, 'Tilicho Lake'],
  ] },
  { name: 'Annapurna Base Camp Trek', points: [
    [28.2981, 83.7679, 'Nayapul'], [28.3769, 83.8078, 'Ghandruk'], [28.4096, 83.8241, 'Jhinu Danda'], [28.4243, 83.8185, 'Chhomrong'],
    [28.4353, 83.8385, 'Sinuwa'], [28.457, 83.8569, 'Bamboo'], [28.4976, 83.8983, 'Deurali'], [28.5265, 83.9076, 'Machhapuchhre Base Camp'],
    [28.5308, 83.8779, 'Annapurna Base Camp'],
  ] },
  { name: 'Ghorepani Poon Hill Trek', points: [
    [28.2981, 83.7679, 'Nayapul'], [28.3491, 83.7423, 'Tikhedhunga'], [28.3567, 83.7354, 'Ulleri'], [28.4025, 83.6999, 'Ghorepani'],
    [28.4001, 83.6895, 'Poon Hill'], [28.3965, 83.7653, 'Tadapani'], [28.3769, 83.8078, 'Ghandruk'],
  ] },
  { name: 'Mardi Himal Trek', points: [
    [28.276, 83.823, 'Kande'], // approx.
    [28.3045, 83.8283, 'Australian Camp'], [28.3134, 83.8305, 'Pothana'], [28.3836, 83.8432, 'Forest Camp'], [28.4032, 83.857, 'Low Camp'],
    [28.4335, 83.8678, 'High Camp'], [28.46, 83.895, 'Mardi Himal Base Camp'],
  ] },
  { name: 'Khopra Ridge Trek', points: [
    [28.4025, 83.6999, 'Ghorepani'], [28.4352, 83.691, 'Swanta'], [28.4721, 83.7086, 'Khopra Danda'],
  ] },
  { name: 'Langtang Valley Trek', points: [
    [28.1617, 85.3447, 'Syabrubesi'], // approx.
    [28.1614, 85.4303, 'Lama Hotel'], [28.2006, 85.461, 'Ghoda Tabela'], [28.2117, 85.5183, 'Langtang'], [28.2124, 85.5666, 'Kyanjin Gompa'],
    [28.2132, 85.6005, 'Tserko Ri'],
  ] },
  { name: 'Gosaikunda Trek', points: [
    [28.1128, 85.2961, 'Dhunche'], [28.1109, 85.3402, 'Chandanbari'], [28.0924, 85.3798, 'Laurebina'], [28.083, 85.415, 'Gosaikunda'], // lake approx.
  ] },
  { name: 'Tamang Heritage Trail', points: [
    [28.1617, 85.3447, 'Syabrubesi'], [28.1628, 85.2684, 'Gatlang'], [28.2103, 85.3382, 'Thuman'], [28.1995, 85.367, 'Briddim'],
  ] },
  { name: 'Helambu Trek', points: [
    [27.7728, 85.4291, 'Sundarijal'], [27.8047, 85.4472, 'Chisapani'], // Chisapani approx.
    [27.9291, 85.4856, 'Kutumsang'], [28.0136, 85.4927, 'Tharepati'], [28.0183, 85.5235, 'Melamchi Gaon'], [27.999, 85.5538, 'Tarkeghyang'],
    [27.9441, 85.5955, 'Sermathang'],
  ] },
  { name: 'Ama Yangri Trek', points: [
    [27.833, 85.577, 'Melamchi Bazaar'], // approx.
    [27.9288, 85.5548, 'Kiul'], [27.9591, 85.5511, 'Timbu'], [27.999, 85.5538, 'Tarkeghyang'], [28.0007, 85.5669, 'Ama Yangri Base Camp'],
    [28.0143, 85.5693, 'Ama Yangri'],
  ] },
  { name: 'Manaslu Circuit Trek', points: [
    [28.1353, 84.8547, 'Soti Khola'], [28.209, 84.864, 'Machha Khola'], // approx.
    [28.3514, 84.8959, 'Jagat'], [28.4794, 84.8673, 'Deng'], [28.5451, 84.7679, 'Namrung'], [28.574, 84.702, 'Lho'],
    [28.5847, 84.644, 'Samagaun'], [28.6509, 84.6341, 'Samdo'], [28.6639, 84.5203, 'Larkya La'], [28.6338, 84.4713, 'Bimthang'],
    [28.5195, 84.3586, 'Dharapani'],
  ] },
  { name: 'Tsum Valley Trek', points: [
    [28.474, 84.9627, 'Chumling'], [28.5838, 85.1162, 'Chhokangparo'],
  ] },
  { name: 'Upper Mustang Trek', points: [
    [28.8378, 83.7843, 'Kagbeni'], [28.9311, 83.827, 'Chele'], [28.9812, 83.8397, 'Syangboche'], [29.0631, 83.873, 'Ghami'],
    [29.1828, 83.9563, 'Lo Manthang'],
  ] },
  { name: 'Nar Phu Valley Trek', points: [
    [28.5522, 84.2593, 'Koto'], [28.6554, 84.2373, 'Meta'], [28.773, 84.2728, 'Phu'], [28.6811, 84.1986, 'Nar'], [28.6884, 84.1241, 'Kang La'],
  ] },
  { name: 'Kanchenjunga Base Camp Trek', points: [
    [27.3509, 87.6957, 'Taplejung'], [27.5692, 87.9773, 'Tseram'], [27.6619, 87.9349, 'Ghunsa'], [27.7901, 88.0356, 'Lhonak'],
    [27.7878, 88.1101, 'Pangpema'],
  ] },
  { name: 'Makalu Base Camp Trek', points: [
    [27.3173, 87.1969, 'Tumlingtar'], [27.557, 87.2845, 'Num'], [27.6265, 87.2324, 'Tashigaon'], [27.6564, 87.2079, 'Khongma Danda'],
    [27.7972, 87.1265, 'Langmale Kharka'], [27.8353, 87.0761, 'Makalu Base Camp'],
  ] },
  { name: 'Rara Lake Trek', points: [
    [29.5206, 82.1467, 'Talcha'], [29.5282, 82.0926, 'Rara Lake'], [29.5362, 82.0397, 'Murma Top'],
  ] },
  { name: 'Shey Phoksundo Trek', points: [
    [28.9797, 82.8201, 'Juphal'], [28.9543, 82.8942, 'Dunai'], [29.0567, 82.8971, 'Chhepka'], [29.1703, 82.9365, 'Ringmo'],
    [29.1959, 82.9522, 'Phoksundo Lake'],
  ] },
  { name: 'Pikey Peak Trek', points: [
    [27.4416, 86.4761, 'Jhapre'], [27.5325, 86.4728, 'Pikey Peak'], [27.5822, 86.5469, 'Junbesi'],
  ] },
  { name: 'Kalinchowk Trek', points: [
    [27.765, 86.03, 'Kuri'], // approx.
    [27.7578, 86.0337, 'Kalinchowk Bhagwati'],
  ] },
  { name: 'Panchase Trek', points: [
    [28.2101, 83.8907, 'Bhumdi'], [28.2186, 83.8115, 'Panchase Bhanjyang'], [28.2344, 83.7876, 'Panchase Lake'],
  ] },
  { name: 'Ruby Valley Trek', points: [
    [28.1771, 85.0852, 'Sertung'], [28.1802, 85.1066, 'Tipling'], [28.1628, 85.1716, 'Pangsang Pass'], [28.19, 85.1995, 'Somdang'],
  ] },
  { name: 'Dhampus Australian Camp Trek', points: [
    [28.2917, 83.8717, 'Phedi'], [28.3003, 83.8587, 'Dhampus'], [28.3045, 83.8283, 'Australian Camp'], [28.3134, 83.8305, 'Pothana'],
  ] },
  { name: 'Shivapuri Hike', points: [
    [27.7781, 85.3623, 'Budhanilkantha'], [27.7833, 85.3817, 'Nagi Gompa'], [27.8122, 85.3844, 'Shivapuri Peak'],
  ] },
  { name: 'Nagarkot Chisapani Trek', points: [
    [27.7728, 85.4291, 'Sundarijal'], [27.8047, 85.4472, 'Chisapani'], [27.7184, 85.5191, 'Nagarkot'],
  ] },
];
